# Exegol as Novatrix sandbox image

[Exegol](https://exegol.readthedocs.io/) is a community offensive-security environment distributed as Docker images with a very large pre-installed toolset (hundreds of tools, depending on image variant). Novatrix does **not** vendor that image; you pull it from Docker Hub and point `SANDBOX_IMAGE` at it.

## Web UI (no `.env` edit required)

With `SANDBOX_MODE=docker` on the server, open the **Sandbox (per session)** panel in the Novatrix sidebar: enable **Exegol**, optionally override the image tag, choose **bridge** if the container needs outbound access, then **Save sandbox settings**. The next chat run pulls the image automatically (or use **Pull images now**). Enable **both** Novatrix and Exegol so the model can call `terminal_exec` with `sandbox_profile` `"novatrix"` or `"exegol"` per command.

## Quick setup

1. Pull an image (pick a tag that matches your needs; see [Exegol docs](https://exegol.readthedocs.io/en/latest/getting-started/installation/)):

   ```bash
   docker pull nwodtuhs/exegol:web
   ```

   Common tags include `free`, `full`, `web`, `ad`, `light`, `osint`, and `nightly`.

2. In `.env` (or your deployment env):

   ```env
   SANDBOX_MODE=docker
   SANDBOX_IMAGE=nwodtuhs/exegol:web
   SANDBOX_DOCKER_NETWORK=bridge
   ```

   Use `SANDBOX_DOCKER_NETWORK=bridge` when the agent must reach your lab targets or the Internet from inside the container. Keep `none` only if you intentionally block outbound traffic.

3. **Entrypoint**: Exegol images ship with their own `ENTRYPOINT`. Novatrix detects `exegol` in the image name and runs commands with `docker run --entrypoint /bin/bash … -lc "<command>"` so `terminal_exec` behaves like the default `novatrix-sandbox` image. To disable that (use the image default entrypoint and append `/bin/bash -lc` instead), set:

   ```env
   SANDBOX_DOCKER_ENTRYPOINT=none
   ```

   To force bash entrypoint for any other image:

   ```env
   SANDBOX_DOCKER_ENTRYPOINT=bash
   ```

## Agent behavior

The agent still uses a single `terminal_exec` tool; it does not get 400 discrete MCP tools. The manifest hint in `infra/docker/tools.manifest.yaml` and the system prompt describe that **any** CLI present in the container is fair game—use `command -v` / `which` before assuming paths.

## Legal and scope

Use Exegol only where you have **explicit authorization**. Novatrix allowlists still apply to `http_request` and `browser_navigate`; `terminal_exec` is constrained by your Docker network mode and your own policies.
