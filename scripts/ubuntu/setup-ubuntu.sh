#!/usr/bin/env bash
# Novatrix — prepare Ubuntu 22.04 / 24.04 (or Debian 12+) for building and running the app.
# Does NOT clone the repo; run this on your machine or EC2, then clone Novatrix and `npm install`.
#
# Usage (from repo root, or after copying this file elsewhere):
#   chmod +x scripts/ubuntu/setup-ubuntu.sh
#   ./scripts/ubuntu/setup-ubuntu.sh
#
# Optional environment:
#   INSTALL_DOCKER=1   — also install Docker Engine + compose plugin (for Postgres stack / sandbox image)

set -euo pipefail

SUDO=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO="sudo"
fi

echo "==> Novatrix: Ubuntu setup (Node 20 + build tools)"
$SUDO apt-get update -y
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  build-essential

if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [[ "${NODE_MAJOR:-0}" -lt 18 ]] && NEED_NODE=1 || NEED_NODE=0
fi
if [[ "${NEED_NODE:-0}" -eq 1 ]]; then
  echo "==> Installing Node.js 20.x (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
unset NEED_NODE NODE_MAJOR 2>/dev/null || true

echo "==> Node: $(node -v)  npm: $(npm -v)"

if [[ "${INSTALL_DOCKER:-}" == "1" ]]; then
  echo "==> Installing Docker (docker.io + compose plugin)"
  $SUDO apt-get install -y docker.io docker-compose-plugin
  $SUDO systemctl enable --now docker 2>/dev/null || true
  echo "If you use Docker as a non-root user, log out and back in after: sudo usermod -aG docker \"\$USER\""
fi

echo ""
echo "Next steps (from your home or projects directory):"
echo "  git clone git@github.com:MaramHarsha/Novatrix.git && cd Novatrix"
echo "  cp .env.example .env   # then edit .env"
echo "  docker compose up -d   # optional: Postgres + Redis"
echo "  npm install && npm run db:push && npm run dev"
