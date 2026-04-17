# GitHub Actions & container images — beginner guide (Novatrix)

This document explains **what GitHub Actions does in this repo**, how to **run workflows successfully**, and how to **use the published images** on a server (for example AWS EC2). No prior CI/CD experience is required.

---

## 1. What you are looking at

- **GitHub** hosts your source code.
- **GitHub Actions** runs small scripts (**workflows**) on Microsoft-hosted Linux machines whenever something happens (for example: you push code, you publish a release, or you click “Run workflow”).
- This repository includes **`.github/workflows/docker-ghcr.yml`**, which **builds Docker images** and **pushes** them to **GHCR** (GitHub Container Registry), similar to Docker Hub but tied to GitHub.

After a successful run, you can **`docker pull`** those images on EC2 instead of building everything from source (saves time and avoids “works on my laptop” build differences).

---

## 2. What `docker-ghcr.yml` builds

| Image name (example) | What it is |
|----------------------|------------|
| `ghcr.io/<your-github-username-lowercase>/novatrix-sandbox` | Pentest tool container (`infra/docker/sandbox.Dockerfile`) |
| `ghcr.io/<your-github-username-lowercase>/novatrix-web` | Production Next.js app (`infra/docker/web.Dockerfile`, target `runner`) |
| `ghcr.io/<your-github-username-lowercase>/novatrix-worker` | Same Dockerfile, target `novatrix-worker` (BullMQ worker) |

`<your-github-username-lowercase>` is your GitHub **owner** name, forced to **lowercase** (GHCR requirement). If your username is `MyUser`, images live under `ghcr.io/myuser/…`.

---

## 3. When the workflow runs

| Trigger | What happens |
|---------|----------------|
| **Push to `main`** | Only jobs whose files **changed** (path filter) run — sandbox vs web/worker. |
| **GitHub Release** | All three images rebuild (good for version tags). |
| **workflow_dispatch** | Manual run from the Actions tab — **all three** image jobs run (same as a release), so you can rebuild without changing code. |

To see runs: **GitHub repo → Actions → “Publish Container Images (GHCR)”**.

---

## 4. Authentication (beginner-friendly)

For **public** repositories, the default **`GITHUB_TOKEN`** in Actions can push packages to `ghcr.io` for that repo **if** workflow permissions allow it.

This workflow sets:

```yaml
permissions:
  contents: read
  packages: write
```

You **do not** need to create Docker Hub credentials for GHCR in most cases.

**First-time checklist**

1. Push the workflow file to **`main`** on GitHub (merge your PR).
2. Open **Actions** and confirm the workflow appears **green**.
3. Open **Packages** (right side of the org/user profile, or **Code → Packages** on the repo). You should see `novatrix-web`, etc.

If the package is **private** by default, either:

- Make the package **public** (Settings of the package → Change visibility), **or**
- On the server, run `docker login ghcr.io` with a **Personal Access Token (classic)** that has `read:packages` (and `write:packages` if you push from CI elsewhere).

---

## 5. Run the workflow manually (workflow_dispatch)

1. On GitHub: **Actions** → **Publish Container Images (GHCR)**.
2. Click **Run workflow** (branch: `main`).
3. Wait for green checkmarks.

If a **push** workflow skips a job, the path filter saw no relevant file changes. Use **Run workflow** (workflow_dispatch) or a **Release** to rebuild without editing files.

---

## 6. Pull and run on AWS EC2 (minimal)

Replace `OWNER` with your **lowercase** GitHub username and log in if the package is private:

```bash
docker pull ghcr.io/OWNER/novatrix-web:latest
docker pull ghcr.io/OWNER/novatrix-sandbox:latest
```

The **web** image expects env vars at runtime (e.g. `DATABASE_URL`). Use **docker run** with `-e` / `--env-file`, or prefer **docker compose** with your own override file. For a **full VM install from git** (Node + Postgres + build on the box), use **`scripts/ubuntu/setup-ubuntu.sh`** and [DEPLOY-AWS-EC2.md](./DEPLOY-AWS-EC2.md) instead of only pulling images.

---

## 7. Troubleshooting

| Problem | What to try |
|---------|-------------|
| **403 / denied** pushing to GHCR | Confirm `permissions: packages: write` in the workflow; re-run on `main`. |
| **Job skipped** | Path filter: edit a file under `infra/docker/`, `apps/web/`, `packages/`, or create a **Release**. |
| **Cannot pull on EC2** | `docker login ghcr.io` with a PAT; or make the package public. |
| **AMD64 only** | Workflow builds `linux/amd64`. ARM instances need multi-arch builds (not enabled in this workflow yet). |

---

## 8. Where to learn more

- [GitHub Actions quickstart](https://docs.github.com/en/actions/quickstart)
- [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- Novatrix deploy guide: [DEPLOY-AWS-EC2.md](./DEPLOY-AWS-EC2.md)
