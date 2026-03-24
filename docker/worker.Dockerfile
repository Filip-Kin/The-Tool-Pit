FROM node:22-alpine AS base

# ─── dependency stage ────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY apps/worker/package.json ./apps/worker/

RUN npm install --frozen-lockfile

# ─── build stage ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build --workspace=packages/types
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=apps/worker

# ─── production runner ───────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy only built artifacts + runtime deps
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/package.json ./
COPY --from=builder --chown=worker:nodejs /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=worker:nodejs /app/packages/db/package.json ./packages/db/
COPY --from=builder --chown=worker:nodejs /app/packages/types/dist ./packages/types/dist
COPY --from=builder --chown=worker:nodejs /app/packages/types/package.json ./packages/types/
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/

USER worker

CMD ["node", "apps/worker/dist/index.js"]
