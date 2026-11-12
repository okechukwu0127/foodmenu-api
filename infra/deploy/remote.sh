#!/usr/bin/env bash
# Invoked via SSM as root; credentials never appear in shell arguments/output.
set -euo pipefail
umask 077
cd /srv/foodmenu
mode=${1:?Mode required}
region=${2:?Region required}
bucket=${3:?Bucket required}
parameter=${4:?Parameter required}
release=${5:?Release required}
case "$mode" in prepare|restore|deploy) ;; *) echo "Unknown mode" >&2; exit 1 ;; esac
if [ "$mode" = prepare ] && [ -e .deployment-ready ]; then
  echo "Already deployed; use deploy." >&2
  exit 1
fi
aws s3 cp "s3://$bucket/deploy/$release/release.tar.gz" /tmp/foodmenu-release.tar.gz --region "$region" --only-show-errors
tar -xzf /tmp/foodmenu-release.tar.gz -C /srv/foodmenu
aws ssm get-parameter --name "$parameter" --with-decryption --query Parameter.Value --output text --region "$region" > .env.new
chmod 600 .env.new
mv .env.new .env
registry=$(cut -d/ -f1 <<< "$(sed -n 's/^RUNTIME_IMAGE=//p' .release.env)")
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry" >/dev/null
compose=(docker compose --env-file .env --env-file .release.env -f compose.yml)
"${compose[@]}" --profile tools pull
"${compose[@]}" up -d postgres
for attempt in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then break; fi
  sleep 2
done
# Root-owned nginx file includes the distribution-only origin token.
install -m 0600 nginx.conf /etc/nginx/sites-available/foodmenu
ln -sf /etc/nginx/sites-available/foodmenu /etc/nginx/sites-enabled/foodmenu
nginx -t
systemctl enable --now nginx
if [ "$mode" = prepare ]; then echo "Database prepared; restore existing data before starting application services."; exit 0; fi
if [ "$mode" = restore ]; then
  tables=$("${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\''"')
  [ "$tables" = 0 ] || { echo "Restore refused: target database is not empty." >&2; exit 1; }
  aws s3 cp "s3://$bucket/deploy/$release/database.dump" /tmp/foodmenu-database.dump --region "$region" --only-show-errors
  "${compose[@]}" exec -T postgres sh -c 'pg_restore --single-transaction --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /tmp/foodmenu-database.dump
  aws s3 cp "s3://$bucket/deploy/$release/media.tar.gz" /tmp/foodmenu-media.tar.gz --region "$region" --only-show-errors
  tar -xzf /tmp/foodmenu-media.tar.gz -C /srv/foodmenu
  rm -f /tmp/foodmenu-database.dump /tmp/foodmenu-media.tar.gz
elif [ "$mode" = deploy ]; then
  initialized=$("${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\'' AND tablename = '\''_prisma_migrations'\''"')
  [ "$initialized" = 1 ] || { echo "Deploy refused: migrate the existing database first." >&2; exit 1; }
else echo "Unknown mode" >&2; exit 1; fi
# Restore data first, then deploy only pending schema migrations. Seeds never run
# automatically; the additive catalogue seed runs only via `manage.cjs seed`.
if [ "$mode" = deploy ]; then "${compose[@]}" stop api-gateway identity-service menu-service order-service payment-service; fi
"${compose[@]}" run --rm tools npx prisma migrate deploy
# Daily database + photo backups to the private, expiring S3 prefix.
printf '17 2 * * * root /bin/bash /srv/foodmenu/backup.sh %s %s >/var/log/foodmenu-backup.log 2>&1\n' "$bucket" "$region" > /etc/cron.d/foodmenu-backup
chmod 0644 /etc/cron.d/foodmenu-backup
touch .deployment-ready
systemctl restart foodmenu.service
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4000/api/v1/health >/dev/null; then echo "Gateway healthy"; exit 0; fi
  sleep 2
done
echo "Gateway health check failed; inspect container logs via SSM." >&2
exit 1
