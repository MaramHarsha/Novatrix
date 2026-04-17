# syntax=docker/dockerfile:1
# Next.js 16 production image (monorepo). Build from repository root:
#   docker build -f infra/docker/web.Dockerfile -t novatrix-web:latest .
# Worker image (same file, different target):
#   docker build -f infra/docker/web.Dockerfile --target novatrix-worker -t novatrix-worker:latest .

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/sandbox/package.json packages/sandbox/package.json
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web
COPY packages/agent ./packages/agent
COPY packages/sandbox ./packages/sandbox
COPY prisma ./prisma
COPY infra/docker/tools.manifest.yaml infra/docker/tools.manifest.yaml
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma/OpenNext do not need a real DB at image build time
ENV DATABASE_URL="postgresql://novatrix:novatrix@127.0.0.1:5432/novatrix?schema=public"
# Default manifest path (repo root); matches loadToolCatalogSummary() when TOOL_MANIFEST_PATH is unset
ENV TOOL_MANIFEST_PATH=/app/infra/docker/tools.manifest.yaml
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TOOL_MANIFEST_PATH=/app/infra/docker/tools.manifest.yaml
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=builder /app/apps/web/public /app/apps/web/public
COPY --from=builder /app/infra/docker/tools.manifest.yaml /app/infra/docker/tools.manifest.yaml

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app/apps/web
CMD ["node", "server.js"]

FROM runner AS novatrix-worker
USER root
COPY --from=builder /app/apps/web/scripts /app/apps/web/scripts
RUN chown -R nextjs:nodejs /app/apps/web/scripts
USER nextjs
WORKDIR /app/apps/web
CMD ["node", "scripts/worker.mjs"]
