# Deploy Novatrix on AWS EC2

This guide targets **Ubuntu Server 22.04 or 24.04 LTS** on EC2. The fastest path is the **automated setup script** after a `git clone`; optional steps cover PM2, Nginx, and **GHCR** images.

**Related:** [GITHUB-WORKFLOWS-BEGINNER.md](./GITHUB-WORKFLOWS-BEGINNER.md) (CI + container registry), [LLM-MODELS.md](./LLM-MODELS.md) (providers, UI keys), [EXEGOL.md](./EXEGOL.md) (sandbox image).

---

## 1. What “fully functional” means

| Area | Status | What you need |
|------|--------|----------------|
| **Build** | OK | Node **20+**, `npm install` / `npm ci`, `npm run build` at repo root |
| **Web app** | OK | **Next.js 16.2.x** (`apps/web`); `npm run start` listens on **0.0.0.0:3000** |
| **Database** | Required | PostgreSQL + `DATABASE_URL`; `npm run db:push` after Postgres is up |
| **LLM** | Required for chat | **Either** keys in `.env` **or** keys/models in the **web UI** (sidebar → LLM, stored in `localStorage` and sent per request). Embeddings/memory need an **OpenAI-compatible** key + embedding model when you want retrieval. |
| **Target scope** | Required for real scans | `TARGET_ALLOWLIST` and/or session **Target** in UI/API |
| **Redis + worker** | Optional | `REDIS_URL` + `npm run worker` (or PM2 `novatrix-worker`) |
| **Docker sandbox** | Optional | `SANDBOX_MODE=docker` + image; Docker on EC2; per-session images in UI |

Without Postgres, the API returns database errors. Without any LLM key (env **or** UI), chat returns a **400** with a clear message.

---

## 2. One-command server prep (recommended)

From a **fresh Ubuntu** instance (after SSH):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git
git clone https://github.com/MaramHarsha/Novatrix.git
cd Novatrix
chmod +x scripts/ubuntu/setup-ubuntu.sh
INSTALL_DOCKER=1 NOVATRIX_FULL_SETUP=1 ./scripts/ubuntu/setup-ubuntu.sh
```

This script:

- Installs **Node.js 20**, build tools, **OpenSSL** (Prisma).
- Optionally installs **Docker** + Compose and starts **`docker compose`** (Postgres + Redis from repo `docker-compose.yml`).
- Waits for Postgres, runs **`npm ci`** (falls back to `npm install` if needed), **`npm run db:push`**, **`npm run build`**.

If `db:push` fails (wrong `DATABASE_URL`), edit `.env` (defaults match `docker-compose.yml`), then:

```bash
npm run db:push && npm run build
```

**LLM keys** can remain empty in `.env` if you use the **LLM (browser only)** panel after opening the app.

---

## 3. Git and updates

```bash
cd ~/Novatrix
git pull origin main
INSTALL_DOCKER=1 NOVATRIX_FULL_SETUP=1 ./scripts/ubuntu/setup-ubuntu.sh
```

Or manually: `npm install && npm run db:push && npm run build` when schema or deps change.

---

## 4. AWS prerequisites

1. **EC2** — **t3.small** or larger (2 GB+ RAM for `npm run build` + Node). **20 GB+** gp3 disk.
2. **Security group** — **22** (SSH, restrict to your IP), **80/443** if using Nginx, **3000** only if exposing Next directly.
3. **Elastic IP** (optional) — stable DNS.

---

## 5. Manual EC2 steps (if you skip `NOVATRIX_FULL_SETUP`)

```bash
sudo apt install -y git curl build-essential nginx openssl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Docker (optional):

```bash
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"
# log out and back in for group membership
```

App:

```bash
cd ~
git clone https://github.com/MaramHarsha/Novatrix.git && cd Novatrix
cp .env.example .env
nano .env   # DATABASE_URL, TARGET_ALLOWLIST, optional LLM_* / REDIS_URL / SANDBOX_*
docker compose up -d   # optional local Postgres + Redis
npm install
npm run db:push
npm run build
```

Smoke test:

```bash
cd apps/web
npm run start
```

Open `http://EC2_PUBLIC_IP:3000` if port 3000 is open.

---

## 6. Environment files and Next.js

Next reads **server** env from the process environment. For PM2, either:

- **`cp .env apps/web/.env.production`** at deploy time, or  
- Export variables before `pm2 start`, or use `pm2 ecosystem` `env_file` patterns.

The **browser UI** can supply **LLM** overrides per request; that does not remove the need for **`DATABASE_URL`** on the server for Prisma.

---

## 7. PostgreSQL options

| Option | Notes |
|--------|--------|
| **Docker on EC2** | `docker compose up -d` — use host `localhost` in `DATABASE_URL` when port 5432 is published. |
| **RDS** | Set `DATABASE_URL` to RDS; add SSL query params if required. |
| **Native apt** | Install `postgresql`, create DB/user, set `DATABASE_URL`. |

---

## 8. PM2 (production)

From **repo root**:

```bash
sudo npm install -g pm2
cp .env apps/web/.env.production
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# run the command PM2 prints (systemd)
```

Stop the worker if `REDIS_URL` is unset:

```bash
pm2 stop novatrix-worker && pm2 delete novatrix-worker
```

---

## 9. Nginx + HTTPS

```bash
sudo cp infra/nginx/novatrix.conf.example /etc/nginx/sites-available/novatrix
sudo nano /etc/nginx/sites-available/novatrix
sudo ln -sf /etc/nginx/sites-available/novatrix /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.com
```

---

## 10. Pre-built images (GHCR)

CI pushes **`novatrix-sandbox`**, **`novatrix-web`**, **`novatrix-worker`** to `ghcr.io/<lowercase-owner>/…`. See **[GITHUB-WORKFLOWS-BEGINNER.md](./GITHUB-WORKFLOWS-BEGINNER.md)** for login, visibility, and manual runs.

---

## 11. Checklist

| Item | Notes |
|------|--------|
| `.env` | Never commit; optional LLM keys if using UI only |
| `npm run build` | After code pulls that change deps or Next |
| `npm run db:push` | After `prisma/schema.prisma` changes |
| Outbound **HTTPS** | Required for OpenAI / Anthropic APIs from EC2 |
| Sandbox scans to Internet | `SANDBOX_DOCKER_NETWORK=bridge` (or session UI override) |
| Long agent runs | Nginx `proxy_read_timeout` in `novatrix.conf.example` |

---

## 12. Operational commands

```bash
cd ~/Novatrix && git pull && npm install && npm run build && npm run db:push
pm2 restart novatrix-web
pm2 logs novatrix-web
```

---

## 13. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Chat **400** / missing key | No LLM key in `.env` **and** none sent from UI; set one. |
| Prisma / `DATABASE_URL` | Postgres not running or wrong host / security group |
| 502 via Nginx | Next not on `127.0.0.1:3000`; check `pm2 status` |
| `npm ci` fails | Run `npm install` once, commit updated `package-lock.json`, or use `NOVATRIX_FULL_SETUP` (script falls back). |

---

## 14. Security (short)

- Set **`MUTATION_API_KEY`** in production for mutating APIs.  
- Use **HTTPS** so browser-supplied LLM keys are not sent in clear text.  
- Restrict SSH; patch the OS regularly.  
- Prefer **`SANDBOX_MODE=docker`** for real isolation when executing tools.
