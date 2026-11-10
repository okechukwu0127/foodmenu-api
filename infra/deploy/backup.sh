#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /srv/foodmenu
bucket=${1:?Backup bucket required}
region=${2:?Region required}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
compose=(docker compose --env-file .env --env-file .release.env -f compose.yml)
"${compose[@]}" exec -T postgres sh -c 'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$work/database.dump"
tar -czf "$work/media.tar.gz" uploads/profile-photos assets
aws s3 cp "$work/database.dump" "s3://$bucket/backups/$stamp/database.dump" --region "$region" --only-show-errors
aws s3 cp "$work/media.tar.gz" "s3://$bucket/backups/$stamp/media.tar.gz" --region "$region" --only-show-errors
echo "Backup completed: $stamp"
