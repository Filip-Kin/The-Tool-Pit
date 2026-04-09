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

# ─── production runner ───────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy node_modules as root first so playwright CLI is available for install
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules

# Install Playwright system dependencies and chromium browser (must run as root)
RUN node apps/worker/node_modules/playwright/cli.js install --with-deps chromium
# Chown node_modules to worker after installation
RUN chown -R worker:nodejs node_modules apps/worker/node_modules

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
