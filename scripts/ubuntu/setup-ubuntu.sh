#!/usr/bin/env bash
# =============================================================================
# Novatrix — Ubuntu 22.04 / 24.04 LTS — single-shot application bootstrap
# =============================================================================
# From the repo root, with no env vars, this typically installs:
#   • OS packages, Node.js 20 LTS, Docker (+ Compose)
#   • Nginx + Certbot (reverse proxy :80 → Next :3000) when INSTALL_NGINX=1 (default on full setup)
#   • Postgres + Redis (docker compose), npm ci, Prisma db push, production build
#   • PM2 (global): start web + worker, save, systemd startup hook (default on full setup)
#   • Docker: novatrix-sandbox:latest build + nwodtuhs/exegol image pull (large)
#
# One-liner after clone:
#   git clone https://github.com/MaramHarsha/Novatrix.git && cd Novatrix && chmod +x scripts/ubuntu/setup-ubuntu.sh && ./scripts/ubuntu/setup-ubuntu.sh
# Or (no clone yet): NOVATRIX_CLONE_URL="https://github.com/MaramHarsha/Novatrix.git" ./scripts/ubuntu/setup-ubuntu.sh
#
# Defaults (unset = automatic described below; override explicitly, e.g. INSTALL_DOCKER=0):
#   INSTALL_DOCKER=1              Monorepo checkout: install Docker if unset.
#   NOVATRIX_FULL_SETUP=1         Monorepo checkout: full app setup if unset.
#   INSTALL_PM2=1                 Install npm -g pm2 when unset and full setup runs.
#   INSTALL_NGINX=1             apt: nginx + certbot + certbot-nginx; deploy proxy config.
#   START_PM2=1                 pm2 start ecosystem.config.cjs after build when unset.
#   PM2_STARTUP=1               Register pm2 with systemd (survives reboot) when unset.
#   BUILD_NOVATRIX_SANDBOX=1     docker build default sandbox image when unset.
#   PULL_EXEGOL=1                docker pull Exegol image when unset (very large).
#
# Lean / CI (smaller / faster):
#   PULL_EXEGOL=0 BUILD_NOVATRIX_SANDBOX=0 INSTALL_NGINX=0 START_PM2=0 PM2_STARTUP=0 ./scripts/ubuntu/setup-ubuntu.sh
#
# Other
#   DOCKER_USE_GET_DOCKER, NOVATRIX_DIR, EXEGOL_TAG, SKIP_DB_PUSH, SKIP_BUILD,
#   SKIP_DOCKER_COMPOSE, FORCE_SYNC_ENV_PRODUCTION, SKIP_PM2_START (=1 skips only pm2 start/startups)
#
# LLM keys may stay empty if you use the web UI (sidebar → LLM).
# =============================================================================

set -euo pipefail

SUDO=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO="sudo"
fi

log() { printf '\n==> %s\n' "$*"; }

# Resolve monorepo root when the script lives at scripts/ubuntu/setup-ubuntu.sh
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
REPO_CANDIDATE="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [[ -f "${REPO_CANDIDATE}/package.json" ]] && [[ -f "${REPO_CANDIDATE}/prisma/schema.prisma" ]] && [[ -d "${REPO_CANDIDATE}/apps/web" ]]; then
  cd "$REPO_CANDIDATE"
fi

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

docker_run() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  elif command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    sudo docker "$@"
  else
    log "WARNING: docker not usable for: docker $*"
    return 1
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

wait_for_redis() {
  local max=40
  local i=0
  log "Waiting for Redis (docker compose)…"
  while [[ $i -lt $max ]]; do
    if docker_compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
      log "Redis is ready."
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  log "WARNING: Redis did not become ready in time (worker may restart until Redis is up)."
  return 1
}

install_pm2_global() {
  if [[ "${INSTALL_PM2:-0}" != "1" ]]; then
    return 0
  fi
  if command -v pm2 >/dev/null 2>&1; then
    log "PM2 already installed: $(command -v pm2)"
    return 0
  fi
  log "Installing PM2 globally (npm install -g pm2)"
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    npm install -g pm2
  else
    $SUDO npm install -g pm2
  fi
}

run_pm2_startup_systemd() {
  [[ "${PM2_STARTUP:-0}" != "1" ]] && return 0
  command -v pm2 >/dev/null 2>&1 || return 0
  log "PM2: registering with systemd (reboot persistence)"
  set +e
  local line
  while IFS= read -r line; do
    if [[ "$line" =~ ^sudo[[:space:]] ]]; then
      eval "$line" || log "WARNING: pm2 startup command failed — run: pm2 startup"
      set -e
      return 0
    fi
  done < <(pm2 startup 2>/dev/null)
  set -e
  log "NOTE: Run manually for reboot persistence: pm2 save && pm2 startup   (copy the sudo line printed)"
}

start_novatrix_pm2() {
  [[ "${START_PM2:-0}" != "1" ]] && return 0
  [[ "${SKIP_PM2_START:-}" == "1" ]] && { log "SKIP_PM2_START=1 — not starting PM2 processes"; return 0; }
  command -v pm2 >/dev/null 2>&1 || { log "WARNING: pm2 not found"; return 1; }

  log "PM2: starting Novatrix (web + worker; worker uses REDIS_URL from .env)"
  (
    cd "$REPO_ROOT"
    if pm2 describe novatrix-web >/dev/null 2>&1; then
      pm2 reload ecosystem.config.cjs --update-env
    else
      pm2 start ecosystem.config.cjs
    fi
    pm2 save
  )
  run_pm2_startup_systemd
}

deploy_nginx_novatrix() {
  [[ "${INSTALL_NGINX:-0}" != "1" ]] && return 0
  local src="$REPO_ROOT/infra/nginx/novatrix.ec2-default.conf"
  if [[ ! -f "$src" ]]; then
    log "WARNING: missing $src — skip Nginx site"
    return 1
  fi
  log "Nginx: enabling reverse proxy :80 → 127.0.0.1:3000 (HTTPS: sudo certbot --nginx -d your.domain later)"
  $SUDO cp "$src" /etc/nginx/sites-available/novatrix
  $SUDO ln -sf /etc/nginx/sites-available/novatrix /etc/nginx/sites-enabled/novatrix
  if [[ -L /etc/nginx/sites-enabled/default ]]; then
    $SUDO rm -f /etc/nginx/sites-enabled/default
  fi
  $SUDO nginx -t
  $SUDO systemctl enable --now nginx 2>/dev/null || true
  $SUDO systemctl reload nginx
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

# --- Defaults -----------------------------------------------------------------------
if [[ -z "${INSTALL_DOCKER+x}" ]]; then
  INSTALL_DOCKER=1
fi
if [[ -z "${NOVATRIX_FULL_SETUP+x}" ]]; then
  if is_novatrix_repo; then
    NOVATRIX_FULL_SETUP=1
  else
    NOVATRIX_FULL_SETUP=0
  fi
fi
if [[ -z "${INSTALL_PM2+x}" ]]; then
  if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
    INSTALL_PM2=1
  else
    INSTALL_PM2=0
  fi
fi
if [[ -z "${BUILD_NOVATRIX_SANDBOX+x}" ]]; then
  if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
    BUILD_NOVATRIX_SANDBOX=1
  else
    BUILD_NOVATRIX_SANDBOX=0
  fi
fi
if [[ -z "${PULL_EXEGOL+x}" ]]; then
  if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
    PULL_EXEGOL=1
  else
    PULL_EXEGOL=0
  fi
fi
if [[ -z "${INSTALL_NGINX+x}" ]]; then
  if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
    INSTALL_NGINX=1
  else
    INSTALL_NGINX=0
  fi
fi
if [[ -z "${START_PM2+x}" ]]; then
  if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
    START_PM2=1
  else
    START_PM2=0
  fi
fi
if [[ -z "${PM2_STARTUP+x}" ]]; then
  if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
    PM2_STARTUP=1
  else
    PM2_STARTUP=0
  fi
fi

if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]] && ! is_novatrix_repo; then
  log "ERROR: Full setup needs the Novatrix repo root. Example:"
  log "  git clone https://github.com/MaramHarsha/Novatrix.git && cd Novatrix && ./scripts/ubuntu/setup-ubuntu.sh"
  log "Or: NOVATRIX_CLONE_URL=https://github.com/MaramHarsha/Novatrix.git ./path/to/setup-ubuntu.sh"
  exit 1
fi

# --- Base apt packages --------------------------------------------------------------
log "Novatrix: apt packages (build tools + TLS)"
APT_EXTRAS=()
if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]] && [[ "${INSTALL_NGINX:-0}" == "1" ]]; then
  APT_EXTRAS+=(nginx certbot python3-certbot-nginx)
fi

$SUDO apt-get update -y
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  build-essential \
  openssl \
  pkg-config \
  "${APT_EXTRAS[@]}"

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

install_pm2_global

# --- Docker -------------------------------------------------------------------------
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
      log "Fixing with Docker's official install script…"
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

if [[ "${INSTALL_DOCKER}" == "1" ]]; then
  install_docker_stack
fi

REPO_ROOT=""

# --- Full application setup ---------------------------------------------------------
if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
  log "Full setup: dependencies, database, Redis, build, Docker images, PM2, Nginx"
  if ! is_novatrix_repo; then
    log "ERROR: not at Novatrix repo root."
    exit 1
  fi
  REPO_ROOT="$(pwd)"

  if [[ ! -f .env ]]; then
    log "Creating .env from .env.example"
    cp .env.example .env
  fi

  if [[ -f .env ]] && [[ -d apps/web ]]; then
    if [[ ! -f apps/web/.env.production ]] || [[ "${FORCE_SYNC_ENV_PRODUCTION:-}" == "1" ]]; then
      log "Copying .env → apps/web/.env.production (Next.js / PM2)"
      cp .env apps/web/.env.production
    else
      log "Keeping existing apps/web/.env.production (FORCE_SYNC_ENV_PRODUCTION=1 overwrites)"
    fi
  fi

  if [[ "${SKIP_DOCKER_COMPOSE:-}" != "1" ]] && command -v docker >/dev/null 2>&1; then
    if [[ -f docker-compose.yml ]]; then
      log "Starting Postgres + Redis (docker compose up -d)"
      docker_compose up -d
      wait_for_postgres || true
      wait_for_redis || true
    fi
  elif [[ "${SKIP_DOCKER_COMPOSE:-}" != "1" ]]; then
    log "WARNING: Docker not installed; skip compose. Set DATABASE_URL / REDIS_URL and run db:push manually."
  fi

  log "npm install (workspace; npm ci when lockfile present)"
  if [[ -f package-lock.json ]]; then
    npm ci || {
      log "npm ci failed; running npm install"
      npm install
    }
  else
    npm install
  fi

  if [[ "${SKIP_DB_PUSH:-}" != "1" ]]; then
    log "Prisma: db push + client (postinstall also runs generate)"
    set +e
    npm run db:push
    DB_PUSH_RC=$?
    set -e
    if [[ "$DB_PUSH_RC" -ne 0 ]]; then
      log "WARNING: npm run db:push failed (exit $DB_PUSH_RC). Fix DATABASE_URL then: npm run db:push"
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

  if command -v docker >/dev/null 2>&1; then
    if [[ "${BUILD_NOVATRIX_SANDBOX}" == "1" ]] && [[ -f infra/docker/sandbox.Dockerfile ]]; then
      log "Docker: building novatrix-sandbox:latest (SANDBOX_IMAGE default; first build is slow)"
      docker_run build -f infra/docker/sandbox.Dockerfile -t novatrix-sandbox:latest . ||
        log "WARNING: novatrix-sandbox build failed — fix Docker/disk, then see infra/docker/sandbox.Dockerfile"
    elif [[ "${BUILD_NOVATRIX_SANDBOX}" == "1" ]]; then
      log "WARNING: infra/docker/sandbox.Dockerfile not found — skip sandbox image build"
    fi

    if [[ "${PULL_EXEGOL}" == "1" ]]; then
      ETAG="${EXEGOL_TAG:-web}"
      log "Docker: pulling nwodtuhs/exegol:${ETAG} (large)"
      docker_run pull "nwodtuhs/exegol:${ETAG}" ||
        log "WARNING: Exegol pull failed — try: docker pull nwodtuhs/exegol:${ETAG}"
    fi
  else
    log "WARNING: docker not on PATH — skipped sandbox image build and Exegol pull"
  fi

  start_novatrix_pm2

  if [[ "${INSTALL_NGINX:-0}" == "1" ]]; then
    deploy_nginx_novatrix || true
  fi

  log "Full setup finished from: $REPO_ROOT"
fi

log "Done."
echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
echo " Novatrix — application stack"
echo "══════════════════════════════════════════════════════════════════════════════"
if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]] && [[ -n "${REPO_ROOT}" ]]; then
  echo "  • Web (PM2):     pm2 status   pm2 logs novatrix-web"
  echo "  • Worker:        pm2 logs novatrix-worker   (needs REDIS_URL; default redis://localhost:6379)"
  echo "  • Direct:        http://127.0.0.1:3000"
  if [[ "${INSTALL_NGINX:-0}" == "1" ]]; then
    echo "  • Via Nginx:     http://$(hostname -I 2>/dev/null | awk '{print $1}')/  (port 80 → 3000)"
    echo "  • HTTPS:         sudo certbot --nginx -d your.domain   (after DNS points here)"
  fi
  echo "  • Dev (optional): cd ${REPO_ROOT} && npm run dev"
else
  echo "  • Dev:     npm run dev  → http://localhost:3000"
  echo "  • Run full setup from monorepo root: ./scripts/ubuntu/setup-ubuntu.sh"
fi
echo ""
echo "  Slim install (no huge images / nginx / pm2): see header in scripts/ubuntu/setup-ubuntu.sh"
echo "  Docs: docs/DEPLOY-AWS-EC2.md"
echo ""
