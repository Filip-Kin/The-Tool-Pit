FROM oven/bun:1.3-alpine AS base

# ─── dependency stage ────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

RUN bun install --frozen-lockfile

# ─── build stage ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app .
COPY . .

RUN bun run --filter @the-tool-pit/types build
RUN bun run --filter @the-tool-pit/db build
RUN bun run --filter @the-tool-pit/worker build

# ─── playwright browser download (cached unless playwright version changes) ───
FROM node:22-bookworm-slim AS playwright-browsers
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
# Download browsers only – no system deps needed just for the download
RUN node apps/worker/node_modules/playwright/cli.js install chromium

# ─── production runner ───────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy node_modules from the deps stage (not builder) so these layers – and the
# playwright install-deps step below – are cache-hit on every code-only deploy.
# They only re-run when bun.lock / package.json files change.
COPY --from=deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=worker:nodejs /app/apps/worker/node_modules ./apps/worker/node_modules

# Install Playwright system dependencies only (no browser download).
# BuildKit cache mounts keep apt packages on the host so repeat builds skip downloads.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    node apps/worker/node_modules/playwright/cli.js install-deps chromium

# Copy pre-downloaded browsers from the cached playwright-browsers stage.
# --chown avoids a separate chown pass over the binary files.
COPY --from=playwright-browsers --chown=worker:nodejs /app/.playwright ./.playwright

# Copy built workspace packages (symlink targets for @the-tool-pit/*)
COPY --from=builder --chown=worker:nodejs /app/packages/db/package.json ./packages/db/
COPY --from=builder --chown=worker:nodejs /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=worker:nodejs /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder --chown=worker:nodejs /app/packages/types/package.json ./packages/types/
COPY --from=builder --chown=worker:nodejs /app/packages/types/dist ./packages/types/dist

# Copy built worker
COPY --from=builder --chown=worker:nodejs /app/package.json ./
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/

USER worker

CMD ["node", "apps/worker/dist/index.js"]
