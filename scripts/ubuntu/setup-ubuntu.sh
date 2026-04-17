#!/usr/bin/env bash
# =============================================================================
# Novatrix — Ubuntu 22.04 / 24.04 LTS bootstrap (AWS EC2, bare metal, WSL2)
# =============================================================================
# Installs Node.js 20 LTS, build tools, OpenSSL (Prisma), optional Docker + Compose.
#
# --- Recommended: one-shot EC2 setup (clone first) ---------------------------
#   git clone https://github.com/MaramHarsha/Novatrix.git && cd Novatrix
#   chmod +x scripts/ubuntu/setup-ubuntu.sh
#   INSTALL_DOCKER=1 NOVATRIX_FULL_SETUP=1 ./scripts/ubuntu/setup-ubuntu.sh
#
# --- Optional: clone from this script ----------------------------------------
#   INSTALL_DOCKER=1 NOVATRIX_CLONE_URL="https://github.com/MaramHarsha/Novatrix.git" \
#     NOVATRIX_FULL_SETUP=1 ./scripts/ubuntu/setup-ubuntu.sh
#   (uses NOVATRIX_DIR, default ~/Novatrix)
#
# Environment variables
#   INSTALL_DOCKER=1       Install Docker Engine + Compose (prefers Ubuntu docker.io; if that
#                          fails with containerd conflicts, runs https://get.docker.com).
#   DOCKER_USE_GET_DOCKER=1 Skip apt and use get.docker.com only (when you know apt will conflict).
#   NOVATRIX_FULL_SETUP=1  After deps: docker compose up -d, wait for Postgres,
#                          npm ci, prisma db push, next build (from repo root).
#   NOVATRIX_CLONE_URL=…   Git HTTPS URL to clone when repo not present.
#   NOVATRIX_DIR=…         Clone destination (default: $HOME/Novatrix).
#   SKIP_DB_PUSH=1         Skip database schema push (run `npm run db:push` later).
#   SKIP_BUILD=1           Skip `npm run build` (e.g. only DB + deps).
#   SKIP_DOCKER_COMPOSE=1  Skip `docker compose up -d` even if Docker exists.
#
# LLM API keys can stay empty in .env if you use the web UI (localStorage).
# =============================================================================

set -euo pipefail

SUDO=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO="sudo"
fi

log() { printf '\n==> %s\n' "$*"; }

docker_compose() {
  if docker info >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo docker compose "$@"
  else
    log "ERROR: docker not usable (permission denied and no sudo)."
    exit 1
  fi
}

is_novatrix_repo() {
  [[ -f package.json ]] && [[ -f prisma/schema.prisma ]] && [[ -d apps/web ]]
}

wait_for_postgres() {
  local max=45
  local i=0
  log "Waiting for Postgres (docker compose)…"
  while [[ $i -lt $max ]]; do
    if docker_compose exec -T postgres pg_isready -U novatrix -d novatrix >/dev/null 2>&1; then
      log "Postgres is ready."
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  log "WARNING: Postgres did not become ready in time. Check: docker compose ps"
  return 1
}

# --- Optional clone ----------------------------------------------------------------
if [[ -n "${NOVATRIX_CLONE_URL:-}" ]]; then
  DEST="${NOVATRIX_DIR:-$HOME/Novatrix}"
  if ! is_novatrix_repo; then
    if [[ ! -d "$DEST/.git" ]]; then
      log "Cloning Novatrix → $DEST"
      git clone "$NOVATRIX_CLONE_URL" "$DEST"
    else
      log "Directory exists: $DEST (skipping clone)"
    fi
    cd "$DEST"
  fi
fi

if [[ "${NOVATRIX_FULL_SETUP:-}" == "1" ]] && ! is_novatrix_repo; then
  log "ERROR: NOVATRIX_FULL_SETUP=1 must run from the Novatrix repo root (after cd), or set NOVATRIX_CLONE_URL to clone first."
  exit 1
fi

# --- Base packages -----------------------------------------------------------------
log "Novatrix: apt packages (build tools + TLS)"
$SUDO apt-get update -y
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  build-essential \
  openssl \
  pkg-config

# --- Node.js 20 LTS -----------------------------------------------------------------
NEED_NODE=0
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "${NODE_MAJOR:-0}" -lt 20 ]]; then
    NEED_NODE=1
  fi
fi
if [[ "$NEED_NODE" -eq 1 ]]; then
  log "Installing Node.js 20.x (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

log "Node: $(node -v)  npm: $(npm -v)"

# --- Docker (optional) ---------------------------------------------------------------
# Ubuntu docker.io uses package "containerd"; Docker Inc. repo uses "containerd.io" — they conflict.
# If you already added download.docker.com, `apt install docker.io` often fails; we then use get.docker.com.
install_docker_stack() {
  if command -v docker >/dev/null 2>&1 && $SUDO docker info >/dev/null 2>&1; then
    log "Docker is already installed and the daemon responds; skipping Docker install."
    return 0
  fi

  if [[ "${DOCKER_USE_GET_DOCKER:-}" == "1" ]]; then
    log "DOCKER_USE_GET_DOCKER=1: using https://get.docker.com"
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    $SUDO sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
  else
    log "Installing Docker Engine + Compose plugin (trying Ubuntu packages first)"
    set +e
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin
    APT_DOCKER_RC=$?
    set -e
    if [[ "$APT_DOCKER_RC" -ne 0 ]]; then
      log "apt install docker.io failed (often: containerd vs containerd.io if Docker's apt repo is enabled)."
      log "Fixing with Docker's official install script (removes conflicting packages, installs docker-ce + compose plugin)…"
      curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
      $SUDO sh /tmp/get-docker.sh
      rm -f /tmp/get-docker.sh
    fi
  fi

  $SUDO systemctl enable --now docker 2>/dev/null || true
  DOCKER_USER="${SUDO_USER:-${USER:-}}"
  if [[ -n "$DOCKER_USER" ]] && [[ "$DOCKER_USER" != root ]] && [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    if id -nG "$DOCKER_USER" 2>/dev/null | grep -qwv docker; then
      $SUDO usermod -aG docker "$DOCKER_USER" || true
      log "NOTE: Added $DOCKER_USER to the docker group. Log out and SSH back in, OR use sudo docker until then."
    fi
  fi
}

if [[ "${INSTALL_DOCKER:-}" == "1" ]]; then
  install_docker_stack
fi

# --- Full application setup (repo root) ---------------------------------------------
if [[ "${NOVATRIX_FULL_SETUP:-}" == "1" ]]; then
  log "NOVATRIX_FULL_SETUP: installing app dependencies and services"
  if ! is_novatrix_repo; then
    log "ERROR: not at Novatrix repo root."
    exit 1
  fi
  REPO_ROOT="$(pwd)"
  if [[ ! -f .env ]]; then
    log "Creating .env from .env.example (edit secrets / DATABASE_URL as needed)"
    cp .env.example .env
  fi

  if [[ "${SKIP_DOCKER_COMPOSE:-}" != "1" ]] && command -v docker >/dev/null 2>&1; then
    if [[ -f docker-compose.yml ]]; then
      log "Starting Postgres + Redis (docker compose up -d)"
      docker_compose up -d
      wait_for_postgres || true
    fi
  elif [[ "${SKIP_DOCKER_COMPOSE:-}" != "1" ]]; then
    log "WARNING: Docker not installed; skip docker compose. Set DATABASE_URL to your Postgres and run db:push manually."
  fi

  log "npm install (root workspace; prefers npm ci when lockfile matches)"
  if [[ -f package-lock.json ]]; then
    npm ci || {
      log "npm ci failed (lockfile drift?); running npm install"
      npm install
    }
  else
    npm install
  fi

  if [[ "${SKIP_DB_PUSH:-}" != "1" ]]; then
    log "Prisma: db push"
    set +e
    npm run db:push
    DB_PUSH_RC=$?
    set -e
    if [[ "$DB_PUSH_RC" -ne 0 ]]; then
      log "WARNING: npm run db:push failed (exit $DB_PUSH_RC). Ensure DATABASE_URL in .env matches a running Postgres, then run: npm run db:push"
    fi
  else
    log "SKIP_DB_PUSH=1 — run later: npm run db:push"
  fi

  if [[ "${SKIP_BUILD:-}" != "1" ]]; then
    log "Production build (Next.js)"
    npm run build
  else
    log "SKIP_BUILD=1 — run later: npm run build"
  fi

  log "Full setup finished from: $REPO_ROOT"
fi

log "Done."
echo ""
echo "Next steps:"
echo "  • Dev:     npm run dev     → http://localhost:3000"
echo "  • Prod:    cp .env apps/web/.env.production   # optional; or export env for PM2"
echo "             pm2 start ecosystem.config.cjs"
echo "  • Docs:    docs/DEPLOY-AWS-EC2.md  ·  docs/GITHUB-WORKFLOWS-BEGINNER.md"
echo ""
