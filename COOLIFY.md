# Coolify Deployment Guide

## Services to create in Coolify

### 1. PostgreSQL (managed by Coolify)
- Use Coolify's built-in PostgreSQL resource
- Note the generated `DATABASE_URL`
- After first deploy, run migrations (see below)

### 2. Redis (managed by Coolify)
- Use Coolify's built-in Redis resource
- Note the generated `REDIS_URL`

### 3. Web App (`apps/web`)
| Setting | Value |
|---|---|
| Build context | `/` (repo root — required for monorepo) |
| Dockerfile | `docker/web.Dockerfile` |
| Exposed port | `3000` |

**Environment variables:**
```
DATABASE_URL=<from Coolify postgres>
REDIS_URL=<from Coolify redis>
NEXT_PUBLIC_URL=https://your-domain.com
ADMIN_SECRET=<strong random string>
VOTE_COOKIE_SECRET=<strong random string, min 32 chars>
GITHUB_TOKEN=<GitHub PAT with read:packages scope>
ANTHROPIC_API_KEY=<Anthropic API key>
NODE_ENV=production
```

### 4. Worker (`apps/worker`)
| Setting | Value |
|---|---|
| Build context | `/` (repo root) |
| Dockerfile | `docker/worker.Dockerfile` |
| Exposed port | none |

**Environment variables** (same as web, minus `NEXT_PUBLIC_URL`):
```
DATABASE_URL=<from Coolify postgres>
REDIS_URL=<from Coolify redis>
GITHUB_TOKEN=<same token>
ANTHROPIC_API_KEY=<same key>
WORKER_CONCURRENCY=2
NODE_ENV=production
```

---

## First-run checklist

- [ ] PostgreSQL service healthy
- [ ] Redis service healthy
- [ ] Run DB migrations via Coolify console:
  ```bash
  cd /app && bun run --filter @the-tool-pit/db db:migrate
  ```
- [ ] Seed reference data (programs + audience taxonomy):
  ```bash
  cd /app && bun run packages/db/src/seed.ts
  ```
- [ ] Deploy web app — verify homepage loads
- [ ] Deploy worker — check logs for "started with concurrency=N"
- [ ] Log in to `/admin` with your `ADMIN_SECRET`
- [ ] Trigger a manual crawl from the admin Crawl Jobs page
- [ ] Verify tools appear on the public homepage after crawl

---

## Notes

### Build context
Both Dockerfiles use the **repository root** as their build context
because shared packages (`packages/db`, `packages/types`) live there.
Set the build context to `/` in Coolify, not `apps/web` or `apps/worker`.

### Migrations
Run `db:migrate` after every deploy that includes schema changes.
Drizzle migrations are in `packages/db/drizzle/` and are safe to re-run.

### Worker restarts
The worker is designed for graceful shutdown (SIGTERM handling).
Coolify's rolling deploys will stop the old worker before starting
the new one — BullMQ jobs are persisted in Redis, so nothing is lost.

### Rate limiting
Vote and submission rate limits use Redis. If Redis restarts, rate
limit counters reset — this is acceptable behavior for v1.
