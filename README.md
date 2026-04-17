# Novatrix

Neo-style **autonomous security assessment** stack (chat UI + agent + sandbox + evidence). Use **only on systems you are authorized to test**.

**Repository:** [github.com/MaramHarsha/Novatrix](https://github.com/MaramHarsha/Novatrix)

## Stack

- **Monorepo** (npm workspaces): `apps/web` (Next.js 15), `packages/agent` (OpenAI tool loop), `packages/sandbox` (Docker CLI or mock shell)
- **PostgreSQL** + Prisma (`docker-compose` uses `pgvector/pgvector:pg16` for optional vector extension experiments)
- **Tier T1** pentest tools in `infra/docker/sandbox.Dockerfile` (ProjectDiscovery: nuclei, httpx, subfinder, katana, dnsx, ffuf + sqlmap)
- **Novatrix UI**: chat + live terminal stream + Browser / HTTP / Network panels + findings list (`apps/web/src/app/page.tsx`)

## Quick start

1. **Clone**

   ```bash
   git clone https://github.com/MaramHarsha/Novatrix.git
   cd Novatrix
   ```

2. **Start Postgres**

   ```bash
   docker compose up -d
   ```

3. **Environment**

   **Linux / macOS:**

   ```bash
   cp .env.example .env
   ```

   **Windows (cmd):** `copy .env.example .env`

   Set `OPENAI_API_KEY` (or compatible provider). Adjust `TARGET_ALLOWLIST` to match your lab targets (comma-separated URL prefixes).

4. **Database**

   ```bash
   npm install
   npm run db:push
   ```

5. **Dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Sandbox modes

- **`SANDBOX_MODE=mock`** (default): commands run on the host inside the session workspace under `artifacts/runs/<runId>` — convenient for development, **not** strong isolation.
- **`SANDBOX_MODE=docker`**: commands run via `docker run` using image `SANDBOX_IMAGE` (default `novatrix-sandbox:latest`). Build it:

  ```bash
  docker build -f infra/docker/sandbox.Dockerfile -t novatrix-sandbox:latest .
  ```

- **`SANDBOX_DOCKER_NETWORK`**: `none` (default) for strong egress isolation, or `bridge` when scans must reach the Internet from the container.

## Optional services

- **Redis + worker**: set `REDIS_URL`, then `npm run worker` to process BullMQ jobs (e.g. `REPORT.md` export after each run).
- **Scoped targets**: create a `Target` via `/api/projects` + `/api/projects/:id/targets`, then `PATCH /api/sessions/:id` with `targetId`. Allowlists merge env `TARGET_ALLOWLIST` with the target URL prefix.
- **Integrations**: `POST /api/integrations/slack` and `POST /api/integrations/github` when env vars from `.env.example` are set.
- **Doc parity checklist**: `docs/neo-acceptance-matrix.md`.

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Production server (`0.0.0.0:3000`) |
| `npm run db:push` | Apply Prisma schema to the database |
| `npm run db:studio` | Prisma Studio GUI |
| `npm run worker` | BullMQ worker (needs `REDIS_URL`) |

## Ubuntu server prep (optional)

On a fresh **Ubuntu 22.04 / 24.04** machine (e.g. before clone + install), you can install Node 20 and build tools:

```bash
chmod +x scripts/ubuntu/setup-ubuntu.sh
./scripts/ubuntu/setup-ubuntu.sh
# optional: INSTALL_DOCKER=1 ./scripts/ubuntu/setup-ubuntu.sh
```

Then clone this repo and follow **Quick start** above.

## AWS EC2 deployment

See **[docs/DEPLOY-AWS-EC2.md](docs/DEPLOY-AWS-EC2.md)** (Node, Postgres, PM2, Nginx, TLS, checklist).

## License

MIT (app code). Third-party tools (nuclei, sqlmap, etc.) have their own licenses — see `infra/docker/tools.manifest.yaml`.
