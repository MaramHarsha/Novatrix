#!/usr/bin/env bash
# Pull a community Exegol image for use as the Exegol sandbox profile (large; tens of GB for full).
# Usage:
#   EXEGOL_TAG=web-3.1.6 ./scripts/docker/pull-exegol.sh
# Tags: web-3.1.6, light-3.1.6, free, full-3.1.6, … — bare "web" was removed; see https://hub.docker.com/r/nwodtuhs/exegol/tags
set -euo pipefail
TAG="${EXEGOL_TAG:-web-3.1.6}"
IMAGE="nwodtuhs/exegol:${TAG}"
echo "Pulling ${IMAGE} (this can take a long time and several GB)…"
docker pull "$IMAGE"
echo ""
echo "Next steps:"
echo "  1. In Novatrix .env set: SANDBOX_MODE=docker (required for any Docker tools)"
echo "  2. Set SANDBOX_DOCKER_NETWORK=bridge if scans need Internet/DNS."
echo "  3. In the web UI → left rail → enable 'Exegol profile', set image to ${IMAGE} if overriding, Save sandbox, Pull images."
echo "  4. Tell the agent to use terminal_exec with sandbox_profile \"exegol\" for commands that need Exegol-only tools."
