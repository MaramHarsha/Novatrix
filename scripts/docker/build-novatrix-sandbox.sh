#!/usr/bin/env bash
# Build the Novatrix Tier-1+ sandbox image (all CLIs in infra/docker/sandbox.Dockerfile).
# Run from repo root:  bash scripts/docker/build-novatrix-sandbox.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TAG="${NOVATRIX_SANDBOX_TAG:-novatrix-sandbox:latest}"
echo "Building $TAG …"
docker build -f infra/docker/sandbox.Dockerfile -t "$TAG" .
echo "Done. Set in .env: SANDBOX_MODE=docker SANDBOX_IMAGE=$TAG"
