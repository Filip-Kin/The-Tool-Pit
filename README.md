# FRC.Tools

One place for the scattered parts of FIRST robotics: the software teams build, the off-season
events they travel to, the practice fields they share, and the photos from the weekend.

It started as a list of the tools I make (FTA Buddy, live captions, a few others) because people kept
asking what else I had built. Then it grew into a directory of every tool worth finding, and then
into the other things below. Live at **[frc.tools](https://frc.tools)**.

## What's in it

- **The Tool Pit** (`/`) - a searchable directory of FRC, FTC and FLL software and CAD: scouting
  apps, calculators, libraries, dashboards.
- **Off-Season Events** (`/events`) - every off-season event on a map, with dates, venue, cost,
  capacity, registration and volunteer links, and the team list where the event publishes one.
- **Practice Fields** (`/fields`) - teams that open a full-size practice field to others, and how to
  arrange a visit.
- **Photos** (`/photos`) - event photo albums, aggregated so they are findable after the event.
- **Robot Code / CAD** (`/robot-code`) - team season code and CAD, browsable by team and year. Its
  own vertical on purpose, kept out of the tools directory.
- **Grants** (`/grants`) - funding a team can apply for. New and still being built out.

Most listings are discovered and enriched automatically, then a person reviews them before they go
public. If a listing is wrong, use **Suggest an edit** on its page. If you run an event, own a tool,
or shot the photos, make an account and **claim** the listing.

## Stack

- **Bun** workspaces + **Turborepo**
- **Next.js 15** (App Router, React 19, Tailwind v4) for the web app
- **BullMQ** + **Redis** worker for discovery, enrichment and scheduled refreshes
- **Drizzle ORM** + **PostgreSQL**
- **Playwright** for reading pages that render client-side
- **Anthropic** models for classification, extraction and writing the per-event team-list parsers
- **Docker** images deployed on **Coolify**

## Layout

```
apps/
  web/       Next.js site + admin
  worker/    BullMQ jobs: crawlers, enrichment, roster refresh
packages/
  db/        Drizzle schema, migrations, client
  types/     shared request/response and job payload types
docker/      Dockerfiles + a compose file for local Postgres/Redis
scripts/     one-off seed and sync utilities
```

## Running it locally

Requires Bun >= 1.3 and Docker (for Postgres and Redis).

```bash
bun install
cp .env.example .env          # fill in the values you need; most have local defaults
docker compose -f docker/docker-compose.yml up -d postgres redis
bun db:migrate
bun dev                       # web on http://localhost:3000, worker alongside
```

Useful scripts: `bun run build`, `bun run type-check`, `bun run test`, `bun run db:studio`.

## Deploying

See [COOLIFY.md](./COOLIFY.md) for the service layout and the environment variables each app needs.

## Contributing

Issues and pull requests are welcome. For a listing that is wrong or missing, the fastest fix is
**Suggest an edit** on the site rather than an issue here.

## License

Copyright (c) 2026 Filip Kin. Licensed under the **GNU Affero General Public License v3.0**. See
[LICENSE](./LICENSE). In short: use it, read it, change it, but if you run a modified version as a
network service, you have to share your source under the same license.
