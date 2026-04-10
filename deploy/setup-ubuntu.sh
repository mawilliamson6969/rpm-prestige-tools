#!/usr/bin/env bash
# =============================================================================
# rpm-prestige-tools — Ubuntu 24.04 LTS VPS bootstrap
#
# What this does:
#   - Updates packages and installs a small baseline (curl, git, firewall).
#   - Installs Docker Engine + the Compose plugin (command: `docker compose`).
#   - Installs Nginx to act as a reverse proxy on the host in front of your containers.
#   - Installs Node.js 20 LTS on the host (useful for one-off scripts/tools; apps use Docker Node).
#   - Installs PostgreSQL 16 on the host. If you ONLY use Postgres inside Docker, you can
#     comment out the PostgreSQL section to avoid running two databases.
#   - Opens SSH plus HTTP/HTTPS in UFW and creates /var/www/rpm-prestige-tools for the app.
#
# Run on the server (must be root or use sudo):
#   curl -fsSL https://raw.githubusercontent.com/mawilliamson6969/rpm-prestige-tools/main/deploy/setup-ubuntu.sh | sudo bash
#
# Before that works, push this script to `main`, or copy it with scp and run:
#   sudo bash /path/to/setup-ubuntu.sh
# =============================================================================
set -euo pipefail

echo "==> [1/10] Updating apt and installing common packages..."
# Non-interactive mode avoids some installers pausing for prompts over SSH.
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw

echo "==> [2/10] Adding Docker's official GPG key and apt repository..."
# Docker publishes packages per Ubuntu codename (noble for 24.04).
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION}") stable" \
  > /etc/apt/sources.list.d/docker.list

echo "==> [3/10] Installing Docker Engine + Compose plugin + Buildx..."
apt-get update -y
# docker-ce = daemon + CLI; docker-compose-plugin provides `docker compose` (V2).
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> [4/10] Enabling Docker to start on boot..."
systemctl enable --now docker

echo "==> [5/10] Installing Nginx (reverse proxy on ports 80/443)..."
apt-get install -y nginx

echo "==> [6/10] Installing Node.js 20.x LTS via NodeSource..."
# This installs Node on the VPS itself. Your containers still use the Node version in each Dockerfile.
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> [7/10] Installing PostgreSQL 16 (host database — optional if you use only Docker Postgres)..."
apt-get install -y postgresql-16 postgresql-client-16

echo "==> [8/10] Allowing SSH, HTTP, and HTTPS through the firewall..."
# Default deny with exceptions: lock yourself out if you enable ufw before allowing ssh!
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> [9/10] Creating application directory..."
APP_DIR="/var/www/rpm-prestige-tools"
mkdir -p "$APP_DIR"
# If you use a non-root deploy user, give them ownership, e.g.:
# chown -R deploy:deploy "$APP_DIR"

echo "==> [10/10] Done."
echo ""
echo "Next steps (run manually once):"
echo "  1) Clone the repo:  sudo git clone https://github.com/mawilliamson6969/rpm-prestige-tools.git $APP_DIR"
echo "  2) cd $APP_DIR && cp .env.example .env && nano .env   # set POSTGRES_PASSWORD"
echo "  3) Install site config: sudo cp deploy/nginx/rpm-prestige.conf /etc/nginx/sites-available/"
echo "     sudo ln -sf /etc/nginx/sites-available/rpm-prestige.conf /etc/nginx/sites-enabled/"
echo "     sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx"
echo "  4) Point DNS A/AAAA records to this server, then optional SSL:"
echo "     sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d yourdomain.com"
echo "  5) Start the stack: cd $APP_DIR && docker compose up -d --build"
echo "  6) Add GitHub Action secrets DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY for auto-deploy."
