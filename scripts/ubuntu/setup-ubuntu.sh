#!/usr/bin/env bash
# =============================================================================
# Novatrix — Ubuntu 22.04 / 24.04 LTS bootstrap (AWS EC2, bare metal, WSL2)
# =============================================================================
# One command from the repo (or after clone): system packages, Node 20, Docker,
# Postgres+Redis (compose), npm install, Prisma db push, production build, PM2.
#
# --- One shot (from clone) ---------------------------------------------------
#   git clone https://github.com/MaramHarsha/Novatrix.git && cd Novatrix
#   chmod +x scripts/ubuntu/setup-ubuntu.sh
#   ./scripts/ubuntu/setup-ubuntu.sh
#
# Or clone via env (starts in empty directory):
#   NOVATRIX_CLONE_URL="https://github.com/MaramHarsha/Novatrix.git" ./scripts/ubuntu/setup-ubuntu.sh
#
# Defaults (override by setting the var explicitly, e.g. INSTALL_DOCKER=0):
#   INSTALL_DOCKER=1       when unset — install Docker Engine + Compose plugin.
#   NOVATRIX_FULL_SETUP=1  when unset and cwd is the monorepo root — compose, npm, db, build.
#   INSTALL_PM2=1          when unset and full setup runs — `npm install -g pm2`.
#
# Other environment variables
#   DOCKER_USE_GET_DOCKER=1 Skip apt Docker packages; use https://get.docker.com only.
#   NOVATRIX_DIR=…         Clone destination when using NOVATRIX_CLONE_URL (default ~/Novatrix).
#   SKIP_DB_PUSH=1         Skip prisma db push.
#   SKIP_BUILD=1           Skip next build.
#   SKIP_DOCKER_COMPOSE=1  Skip docker compose up even if Docker exists.
#   FORCE_SYNC_ENV_PRODUCTION=1  Always copy root .env → apps/web/.env.production (default:
#                          copy only if apps/web/.env.production is missing).
#   PULL_EXEGOL=1          docker pull nwodtuhs/exegol:${EXEGOL_TAG:-web} (large).
#   BUILD_NOVATRIX_SANDBOX=1  docker build novatrix-sandbox:latest (slow).
#
# LLM keys can stay empty in .env if you use the web UI (sidebar → LLM).
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

# --- Defaults: full stack when running inside the checkout (no extra env needed) ---
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

if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]] && ! is_novatrix_repo; then
  log "ERROR: Full setup needs the Novatrix repo root. Example:"
  log "  git clone https://github.com/MaramHarsha/Novatrix.git && cd Novatrix && ./scripts/ubuntu/setup-ubuntu.sh"
  log "Or: NOVATRIX_CLONE_URL=https://github.com/MaramHarsha/Novatrix.git ./path/to/setup-ubuntu.sh"
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

install_pm2_global

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

if [[ "${INSTALL_DOCKER}" == "1" ]]; then
  install_docker_stack
fi

# --- Full application setup (repo root) ---------------------------------------------
if [[ "${NOVATRIX_FULL_SETUP}" == "1" ]]; then
  log "Full setup: dependencies, DB, production build"
  if ! is_novatrix_repo; then
    log "ERROR: not at Novatrix repo root."
    exit 1
  fi
  REPO_ROOT="$(pwd)"
  if [[ ! -f .env ]]; then
    log "Creating .env from .env.example (edit secrets / DATABASE_URL as needed)"
    cp .env.example .env
  fi

  if [[ -f .env ]] && [[ -d apps/web ]]; then
    if [[ ! -f apps/web/.env.production ]] || [[ "${FORCE_SYNC_ENV_PRODUCTION:-}" == "1" ]]; then
      log "Copying .env → apps/web/.env.production (Next.js / PM2)"
      cp .env apps/web/.env.production
    else
      log "Keeping existing apps/web/.env.production (set FORCE_SYNC_ENV_PRODUCTION=1 to overwrite from .env)"
    fi
  fi

  if [[ "${SKIP_DOCKER_COMPOSE:-}" != "1" ]] && command -v docker >/dev/null 2>&1; then
    if [[ -f docker-compose.yml ]]; then
      log "Starting Postgres + Redis (docker compose up -d)"
      docker_compose up -d
      wait_for_postgres || true
    fi
  elif [[ "${SKIP_DOCKER_COMPOSE:-}" != "1" ]]; then
    log "WARNING: Docker not installed; skip docker compose. Set DATABASE_URL in .env to your Postgres, then: npm run db:push"
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

if [[ "${PULL_EXEGOL:-}" == "1" ]] && command -v docker >/dev/null 2>&1 && is_novatrix_repo; then
  ETAG="${EXEGOL_TAG:-web}"
  log "PULL_EXEGOL=1: docker pull nwodtuhs/exegol:${ETAG} (may take a long time)"
  docker pull "nwodtuhs/exegol:${ETAG}" || log "WARNING: Exegol pull failed — run: bash scripts/docker/pull-exegol.sh later"
fi

if [[ "${BUILD_NOVATRIX_SANDBOX:-}" == "1" ]] && command -v docker >/dev/null 2>&1 && is_novatrix_repo; then
  log "BUILD_NOVATRIX_SANDBOX=1: docker build novatrix-sandbox:latest"
  docker build -f infra/docker/sandbox.Dockerfile -t novatrix-sandbox:latest . || log "WARNING: sandbox image build failed"
fi

log "Done."
echo ""
echo "Novatrix is ready."
echo "  • Dev:  npm run dev   → http://localhost:3000"
echo "  • Prod: pm2 start ecosystem.config.cjs   # from repo root (pm2 installed by this script when full setup ran)"
echo "          pm2 save && pm2 startup   # optional: survive reboot"
echo "  • Docs: docs/DEPLOY-AWS-EC2.md"
echo ""
echo "Optional: Docker sandbox image for scanners — BUILD_NOVATRIX_SANDBOX=1 $0   (slow first build)"
echo ""
