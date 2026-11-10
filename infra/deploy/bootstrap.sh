#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# The Elastic IP is associated shortly after instance creation.
for attempt in $(seq 1 60); do
  if curl -fsS --connect-timeout 5 https://download.docker.com >/dev/null; then break; fi
  sleep 5
done
apt-get update -o Acquire::Retries=5
apt-get install -y ca-certificates curl gnupg nginx unzip python3
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
. /etc/os-release
printf 'deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp/awscli-install
/tmp/awscli-install/aws/install --update
systemctl enable --now docker
# Ubuntu AWS AMIs include the SSM agent. Keep it enabled for keyless management.
if snap list amazon-ssm-agent >/dev/null 2>&1; then snap start --enable amazon-ssm-agent; else
  curl -fsSL https://s3.eu-west-2.amazonaws.com/amazon-ssm-eu-west-2/latest/debian_arm64/amazon-ssm-agent.deb -o /tmp/ssm.deb
  dpkg -i /tmp/ssm.deb
  systemctl enable --now amazon-ssm-agent
fi
install -d -m 0700 /srv/foodmenu /srv/foodmenu/data /srv/foodmenu/uploads/profile-photos
cat > /etc/systemd/system/foodmenu.service <<'UNIT'
[Unit]
Description=FoodMenu Docker services
Requires=docker.service
After=docker.service network-online.target
ConditionPathExists=/srv/foodmenu/.deployment-ready
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/srv/foodmenu
ExecStart=/usr/bin/docker compose --env-file .env --env-file .release.env -f compose.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose --env-file .env --env-file .release.env -f compose.yml stop
TimeoutStartSec=300
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable foodmenu.service
# Do not expose the default nginx welcome page during bootstrap.
rm -f /etc/nginx/sites-enabled/default
systemctl stop nginx
install -d /var/lib/foodmenu
touch /var/lib/foodmenu/bootstrap-complete
