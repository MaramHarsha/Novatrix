# Exegol + Novatrix sandbox

[Exegol](https://exegol.readthedocs.io/) ships **hundreds** of offensive tools in Docker images. Novatrix does **not** copy that stack into `novatrix-sandbox`; you use a **second profile** that runs commands in `nwodtuhs/exegol:*`.

The **Novatrix** image (`infra/docker/sandbox.Dockerfile`) bundles a **large but finite** Go/apt/pip toolchain. Anything missing there is either added to the Dockerfile or run via **Exegol**.

## Why tools look “missing”

| Symptom | Cause | Fix |
|--------|--------|-----|
| Agent says “tool not found” / only basic shell | **`SANDBOX_MODE=mock`** (default in `.env`) | Set **`SANDBOX_MODE=docker`**, rebuild or pull **`novatrix-sandbox:latest`**, restart the app |
| Old or empty `novatrix-sandbox` image | Never rebuilt after `git pull` | Run **`bash scripts/docker/build-novatrix-sandbox.sh`** (or `docker build -f infra/docker/sandbox.Dockerfile -t novatrix-sandbox:latest .`) |
| Scans cannot resolve DNS or reach targets | **`SANDBOX_DOCKER_NETWORK=none`** | Set **`bridge`** (globally in `.env` and/or per session in the UI) |
| Tool exists in Exegol but not Novatrix | Expected | Enable **Exegol profile**, **Save sandbox**, **Pull images**, use `sandbox_profile: "exegol"` in `terminal_exec` |
| Exegol pull fails / out of disk | Full image is **tens of GB** | Use a smaller tag (`light-3.1.6`, `osint-3.1.6`, `free`) or free space; see [Docker Hub tags](https://hub.docker.com/r/nwodtuhs/exegol/tags) — bare `:web` was removed; use e.g. `web-3.1.6`. |

## Quick: Docker + Novatrix image

From the **repository root**:

```bash
# 1) Build the fat Novatrix sandbox (many CLIs)
bash scripts/docker/build-novatrix-sandbox.sh

# 2) Point the app at Docker
# In .env:
SANDBOX_MODE=docker
SANDBOX_IMAGE=novatrix-sandbox:latest
SANDBOX_DOCKER_NETWORK=bridge
```

Restart `npm run dev` / PM2 / Docker so env is picked up.

## Quick: Exegol image (optional)

```bash
# Example: web-focused image (still large — plan disk/time)
bash scripts/docker/pull-exegol.sh
# or:  EXEGOL_TAG=light bash scripts/docker/pull-exegol.sh
```

Then in the **web UI** (left rail):

1. Enable **Exegol profile**.
2. Override image if needed (default `nwodtuhs/exegol:web-3.1.6`).
3. Set **network** to **bridge** if the container must reach the Internet or your lab.
4. **Save sandbox** → **Pull images**.

On the next chat message, Novatrix pulls when the session signature changes. The agent should choose `sandbox_profile` **`novatrix`** vs **`exegol`** depending on which tools it needs.

## Server env (Exegol as default single image)

If you want **only** Exegol (not the custom Novatrix image) for `SANDBOX_IMAGE`:

```env
SANDBOX_MODE=docker
SANDBOX_IMAGE=nwodtuhs/exegol:web-3.1.6
SANDBOX_DOCKER_NETWORK=bridge
```

Per-session UI overrides still apply when multiple profiles are enabled (see schema on `Session`).

## Entrypoint

Exegol images define their own `ENTRYPOINT`. Novatrix forces `--entrypoint /bin/bash` when the image name matches `exegol` so `terminal_exec` runs your shell command predictably. Override via `SANDBOX_DOCKER_ENTRYPOINT` — see `.env.example`.

## Agent behavior

There is **one** `terminal_exec` tool; you do **not** get separate MCP tool names for each binary. The model should run `command -v toolname` or `--help` before assuming a path. The tool manifest (`infra/docker/tools.manifest.yaml`) lists what the **Novatrix** image includes; Exegol is described as “everything in the image”.

## Legal / scope

Use Exegol only where you are **authorized**. HTTP/browser tools still honor `TARGET_ALLOWLIST`; `terminal_exec` follows Docker network and your policies.
