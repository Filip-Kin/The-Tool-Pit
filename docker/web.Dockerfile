FROM oven/bun:1.3-alpine AS base

# ─── dependency stage ────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

# Copy workspace manifests only — avoids cache busting on source changes
COPY package.json bun.lock ./
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/

# Retry once with a cleared cache: large tarballs (e.g. next) occasionally fail to
# extract on the build server, and a stale/partial cache entry makes it stick.
# Same guard worker.Dockerfile has had since e9625bd; the web build hit the
# identical "Fail extracting tarball for next" on 2026-09-01.
RUN bun install --frozen-lockfile || { bun pm cache rm 2>/dev/null || true; rm -rf node_modules; bun install --frozen-lockfile; }

# ─── build stage ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app .
COPY . .

# Build shared packages first (web depends on them)
RUN bun run --filter @the-tool-pit/types build
RUN bun run --filter @the-tool-pit/db build

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone

# `next build` prerenders DB-backed pages, so the build needs to reach Postgres +
# Redis. When building on the NAS build server (which can't route to the cloud's
# docker network), Coolify passes these build args pointing at the cloud DB/Redis
# over Tailscale. They apply to the build stage ONLY; the runtime container keeps
# its internal Coolify service-name DATABASE_URL/REDIS_URL. Empty locally = falls
# back to whatever env is already set.
ARG BUILD_DATABASE_URL
ARG BUILD_REDIS_URL
ENV DATABASE_URL=${BUILD_DATABASE_URL:-$DATABASE_URL}
ENV REDIS_URL=${BUILD_REDIS_URL:-$REDIS_URL}
RUN bun run --filter @the-tool-pit/web build

# ─── production runner ───────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# next build --standalone copies only what's needed
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
# public dir may not exist yet; create it so COPY doesn't fail
RUN mkdir -p apps/web/public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
