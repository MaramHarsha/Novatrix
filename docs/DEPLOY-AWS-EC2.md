# Deploy Novatrix on AWS EC2

This guide assumes **Ubuntu Server 22.04 or 24.04 LTS** on EC2. Adjust package names if you use Amazon Linux.

## 1. Is the application “fully functional”?

**Yes, for a documented production path**, with these runtime requirements:

| Area | Status | What you need |
|------|--------|----------------|
| **Build** | OK | `npm install` + `npm run build` at repo root |
| **Web app** | OK | Next.js 15; `npm run start` binds **0.0.0.0:3000** (reachable from EC2 public IP / Nginx) |
| **Database** | Required | PostgreSQL + `DATABASE_URL`; run `npm run db:push` after Postgres is up |
| **LLM** | Required | `OPENAI_API_KEY` (or compatible provider via `OPENAI_BASE_URL`) |
| **Target scope** | Required for real scans | `TARGET_ALLOWLIST` and/or session **Target** in UI/API |
| **Redis + worker** | Optional | `REDIS_URL` + `npm run worker` for post-run `REPORT.md` jobs |
| **Docker sandbox** | Optional | `SANDBOX_MODE=docker` + built image; Docker daemon on EC2 |

Without Postgres and `OPENAI_API_KEY`, the UI loads but chat returns errors. That is expected, not a broken codebase.

---

## 2. Git (clone / update)

Clone the application:

```bash
git clone https://github.com/MaramHarsha/Novatrix.git
cd Novatrix
```

To pull latest on a server:

```bash
git pull origin main
```

**First-time Git identity** (if commits fail locally):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

**Prepare a fresh Ubuntu machine** (Node, build tools; optional Docker): `chmod +x scripts/ubuntu/setup-ubuntu.sh && ./scripts/ubuntu/setup-ubuntu.sh` (see `INSTALL_DOCKER=1` in the script header).

---

## 3. AWS prerequisites

1. **EC2 instance**  
   - t3.small or larger recommended (2 GB+ RAM for `npm run build` + Node).  
   - Storage: 20 GB+ gp3.

2. **Security group inbound**  
   - **22** — SSH (restrict to your IP).  
   - **80** / **443** — HTTP/HTTPS if you use a browser.  
   - **3000** — only if you expose Next directly (not needed if you use Nginx on 80/443).

3. **Elastic IP** (optional) — stable public IP for DNS.

---

## 4. EC2 server setup (Ubuntu)

SSH in as `ubuntu` (or your AMI user), then:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential nginx
```

### Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### Docker (optional — for `SANDBOX_MODE=docker` and/or Postgres in Docker)

```bash
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"
# log out and back in for group to apply
```

---

## 5. Clone and install the app

```bash
cd ~
git clone git@github.com:MaramHarsha/Novatrix.git
cd Novatrix
cp .env.example .env
nano .env   # fill DATABASE_URL, OPENAI_API_KEY, TARGET_ALLOWLIST, etc.
```

**Important for Next.js**: env vars are read from **`apps/web`** when you run `npm run start` with `cwd` there. Either:

- Copy env into the web app: `cp .env apps/web/.env.production`, **or**
- Export variables in the shell / PM2 before start (see PM2 section).

Install and build:

```bash
npm install
npm run build
```

Apply the database schema (Postgres must be reachable):

```bash
npm run db:push
```

Smoke test (foreground):

```bash
cd apps/web
export $(grep -v '^#' ../../.env | xargs)   # quick load; or set vars manually
npm run start
```

Visit `http://EC2_PUBLIC_IP:3000` (if security group allows 3000). Ctrl+C to stop.

---

## 6. PostgreSQL options

**A) RDS** — set `DATABASE_URL` to the RDS connection string (SSL params as required by AWS).

**B) Docker on the same EC2** — from repo root:

```bash
docker compose up -d postgres redis
```

Use `DATABASE_URL` from `.env.example` pattern, host `localhost` if Postgres port is published.

**C) Postgres on EC2 without Docker** — install `postgresql`, create DB/user, set `DATABASE_URL`.

---

## 7. Run with PM2 (recommended)

From **repo root**:

```bash
sudo npm install -g pm2
# Ensure apps/web sees env (example: copy production env)
cp .env apps/web/.env.production

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# Run the command PM2 prints (sudo env PATH=... pm2 startup systemd -u ubuntu --hp /home/ubuntu)
```

**Worker**: only start if `REDIS_URL` is set in the environment PM2 uses. You can delete the worker app from `ecosystem.config.cjs` or run:

```bash
pm2 stop novatrix-worker
pm2 delete novatrix-worker
```

---

## 8. Nginx + HTTPS

```bash
sudo cp infra/nginx/novatrix.conf.example /etc/nginx/sites-available/novatrix
sudo nano /etc/nginx/sites-available/novatrix   # set server_name
sudo ln -sf /etc/nginx/sites-available/novatrix /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.com
```

Point your DNS **A record** to the EC2 public IP.

---

## 9. Checklist — nothing missing?

| Item | Notes |
|------|--------|
| `.env` on server | Never commit; create from `.env.example` |
| `npm run build` | Run after every `git pull` that changes code |
| `npm run db:push` | Run when `prisma/schema.prisma` changes |
| **Outbound HTTPS** from EC2 | Required for OpenAI API |
| **Sandbox scans** | If targets are on the public Internet, set `SANDBOX_DOCKER_NETWORK=bridge` when using Docker |
| **Firewall** | Prefer Nginx on 443 only; avoid exposing 3000 publicly if possible |
| **Streaming / timeouts** | Nginx `proxy_read_timeout` in example is 3600s for long agent runs |

---

## 10. Operational commands

```bash
cd ~/Novatrix && git pull && npm install && npm run build && npm run db:push
pm2 restart novatrix-web
pm2 logs novatrix-web
```

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `OPENAI_API_KEY is not set` | Env not visible to Next process; use `apps/web/.env.production` or PM2 env |
| Prisma `DATABASE_URL` error | Postgres not running / wrong host / security group |
| Blank or 502 via Nginx | Next not listening on 127.0.0.1:3000; check `pm2 status` and `curl -I localhost:3000` |
| Git push asks for password | Use SSH remote or a GitHub Personal Access Token with HTTPS |

---

## 12. Security hardening (short)

- Set **`MUTATION_API_KEY`** in production and store the browser key only for admins.  
- Restrict SSH to your IP; keep the OS patched.  
- Use **HTTPS** only in production.  
- Run **`SANDBOX_MODE=docker`** with a non-root user inside the image for real isolation.
