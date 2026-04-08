# The Tool Pit — Engineering, Product & QA Audit

**Date:** 2026-04-08  
**Auditor:** Claude Code (claude-sonnet-4-6)  
**Branch:** `main` (clean working tree)  
**Scope:** Full codebase — web app, worker, db package, types package

---

## Table of Contents

1. [Overview](#1-overview)
2. [Codebase Inventory](#2-codebase-inventory)
3. [Feature Audit](#3-feature-audit)
4. [Data Model Audit](#4-data-model-audit)
5. [Ingestion Pipeline Audit](#5-ingestion-pipeline-audit)
6. [Search & Ranking Audit](#6-search--ranking-audit)
7. [UX / Product Audit](#7-ux--product-audit)
8. [Testing & Reliability Audit](#8-testing--reliability-audit)
9. [Critical Bugs & Blockers](#9-critical-bugs--blockers)
10. [MVP Gap Analysis](#10-mvp-gap-analysis)
11. [Prioritized Roadmap](#11-prioritized-roadmap)
12. [Suggested Next Actions](#12-suggested-next-actions)

---

## 1. Overview

The Tool Pit is a **Next.js 15 / PostgreSQL / BullMQ monorepo** hosted via Coolify. It has a solid architectural foundation: the schema is well-designed, the ingestion pipeline is structurally sound, and the admin dashboard is more complete than typical early-stage projects.

**Several bugs were found and fixed (Session 1 — 2026-04-08). Remaining known issues:**

- ~~Vote counts on the homepage are always 0 (hardcoded in `enrichTools()`)~~ ✅ Fixed
- ~~The `sort` URL parameter is silently ignored — sort links don't work~~ ✅ Fixed
- Auto-published tools always have `sourceType: 'fta_tools'` regardless of where they came from *(P1)*
- ~~Submissions are never linked back to the tool they create (broken traceability)~~ ✅ Fixed
- ~~The analytics "Top Clicked Tools" table is fetched but never rendered~~ ✅ Fixed
- Name-similarity deduplication is advertised in comments but not implemented *(P2)*
- The `reindexQueue` has no worker — any reindex job silently stalls *(P2)*
- ~~The program page search bar doesn't preserve the program filter on submit~~ ✅ Fixed

The project is approximately **70% complete for MVP** — the skeleton and plumbing exist, but there are enough silent failures and missing connections that the product would feel broken to a real user today.

---

## 2. Codebase Inventory

### Apps

#### `apps/web` — Next.js 15 Frontend + API
- **What it does:** User-facing site (search, browse, tool detail, submit), admin dashboard (tools, candidates, submissions, analytics), and API routes (search, vote, click, submit).
- **Completeness:** ~75%. All major pages exist. Several bugs in data flow (see §3, §9). Admin dashboard is functionally complete but has holes (no crawl jobs page, no sources page, top-clicked analytics not rendered).
- **Framework:** Next.js 15.1, React 19, App Router. Bun workspace. Tailwind CSS.
- **Key directories:**
  - `app/(public)/` — public routes (home, search, tools/[slug], submit, frc, ftc, fll)
  - `app/admin/` — admin dashboard (login, tools, candidates, submissions, analytics)
  - `app/api/` — API routes (search, vote, click, submit)
  - `components/` — search bar, search filters, tool card, tool detail, vote button, program pages, submit form
  - `lib/` — search logic, voting, analytics events, admin publish, queries, submissions, redis client

#### `apps/worker` — BullMQ Job Processor
- **What it does:** Background job processor for crawling, enrichment (AI classification), freshness checks, and submission processing.
- **Completeness:** ~80%. Four active queues with workers. Recurring schedules defined. `reindexQueue` is defined but has no processor. Submission-to-tool traceability is broken (see §9).
- **Runtime:** Node 22 + Bun build, Turborepo pipeline.
- **Key directories:**
  - `src/jobs/` — crawl.ts, enrich.ts, freshness.ts, submission.ts
  - `src/pipeline/` — extract.ts, deduplicate.ts, classify.ts, publish.ts
  - `src/connectors/` — fta-tools.ts, volunteer-systems.ts, github-topics.ts, awesome-list.ts, github.ts (API client)
  - `src/queues.ts` — queue definitions and scheduler setup
  - `src/index.ts` — worker entry point

### Packages

#### `packages/db` — Drizzle ORM Schema + Client
- **What it does:** Single source of truth for database schema, migrations, seed data, and the Drizzle client.
- **Completeness:** ~90%. Schema is comprehensive and well-normalized. Two seed files: `seed.ts` (taxonomy: programs + audience metadata) and `seed-tools.ts` (25 curated real tools). Extensions (`pg_trgm`, `uuid-ossp`) provisioned via `docker/init-db.sql`.
- **Key files:** `src/schema/index.ts` (schema), `src/client.ts` (singleton Drizzle client, pool: 10 prod / 3 dev), `src/seed.ts`, `src/seed-tools.ts`.

#### `packages/types` — Shared TypeScript Types
- **What it does:** Shared request/response types (SearchParams, VoteRequest/Response, SubmitToolRequest/Response) and worker payload types (CrawlJobPayload, EnrichJobPayload, etc.).
- **Completeness:** ~95%. Well-maintained. Not much to add here.

### Infrastructure

| File | Purpose |
|------|---------|
| `docker/docker-compose.yml` | postgres:16-alpine, redis:7-alpine, web (port 3000), worker |
| `docker/init-db.sql` | Creates `pg_trgm` and `uuid-ossp` extensions |
| `docker/web.Dockerfile` | Multi-stage bun→node build, standalone Next.js output |
| `docker/worker.Dockerfile` | Multi-stage bun→node build, runs compiled dist/ |
| `turbo.json` | Build pipeline (build depends on `^build`, dev is persistent) |
| `.env.example` | All required env vars documented |
| `COOLIFY.md` | Deployment notes |

---

## 3. Feature Audit

### Homepage — PARTIAL

**What works:** Hero section with large search bar, browse-by-program cards, and four curated sections (Trending, Rookie Friendly, Official FIRST, Recently Updated). Data is fetched server-side via parallel queries in `app/(public)/page.tsx:12-18`.

**What's broken:**
- **Vote counts are always 0** on homepage tool cards. `enrichTools()` in `lib/queries/tools.ts:53` hardcodes `voteCount: 0` — the function fetches programs and GitHub links but never queries `tool_votes`. Only the search path and tool detail page fetch real vote counts.
- The "Recently Updated" section (`getRecentlyUpdatedTools`) filters by `lastActivityAt IS NOT NULL`. If freshness pass hasn't run (no GitHub links on tools, or worker not running), this section may be empty.
- The "Trending" section sorts by `popularityScore` which is only updated by votes — click events don't contribute despite the comment in `vote.ts:47` saying "click events contribute separately."

---

### Global Search — PARTIAL

**What works:** Full-text search with tsvector/tsquery, ILIKE fallback, program filter, tool type filter, official/rookie filters, and a multi-signal ranking formula. Pagination is implemented. Filter chips update URL params correctly.

**What's broken:**
- **The `sort` parameter is silently ignored.** In `lib/search/search.ts:64`, `sort` is destructured from params but never referenced again. The query always orders by `rankScore desc`. The homepage "See all" links for "Trending" (`/search?sort=popular`) and "Recently Updated" (`/search?sort=updated`) point to URLs that produce identical results to a default sort. Users who follow these links get no feedback that their sort preference is being ignored.
- **`TYPE_WEIGHTS` constant is defined but never used** in the SQL formula (`lib/search/search.ts:9-19`). The ranking formula was clearly intended to include a type weight component, but the final `rankScore` SQL expression does not include it. Dead code.
- **Total count query runs after the main query.** The `count(*)` is a second round-trip. Under high concurrency, inserts between the two queries can cause count/results to be inconsistent, but this is a minor issue.
- The `audienceRole` and `audienceFunction` filter params from `SearchParams` are read in the search page (`params.role`, `params.fn`) and passed to `searchTools()`, but `searchTools()` **never applies them as WHERE conditions**. These filters are silently dropped.

---

### Program Pages (FRC / FTC / FLL) — PARTIAL

**What works:** All three program pages (`/frc`, `/ftc`, `/fll`) exist and render with program-colored heroes. Top tools section uses `searchTools()` filtered by program. Rookie and Official sections filter the global queries client-side via `.filter()`.

**What's broken:**
- **The program page SearchBar does not preserve the program context.** `components/program/program-page.tsx:50` renders `<SearchBar placeholder={...} size="md" />` with no `defaultProgram` or hidden input. Searching from the FRC page sends the user to `/search?q=...` without `&program=frc`. This is a significant UX failure — the user is in a FRC context but their search loses that context.
- **Rookie and Official sections on program pages are filtered in JS, not SQL.** `getOfficialTools(6)` and `getRookieFriendlyTools(6)` fetch the top 6 globally, then filter to those matching the current program. If none of the top-6-globally happen to be in that program, the section disappears. The correct approach is SQL-level filtering with a program predicate.

---

### Tool Detail Page — COMPLETE (mostly)

**What works:** `app/(public)/tools/[slug]/page.tsx` fetches via `getToolBySlug()` which loads all relations: programs, audience roles, functions, all links, and real vote count. Returns 404 for unpublished tools (enforced via `eq(tools.status, 'published')` in the query). Click tracking fires via `trackClick()` in the `ToolDetail` component.

**What's missing:**
- No page view tracking (only link click tracking).
- The `description` field (long-form markdown) is in the schema and fetched in `getToolBySlug()`, but no tools auto-published through the pipeline ever have a description — `publishCandidate()` and `adminPublishCandidate()` only set `summary` (capped at 300 chars), never `description`. The detail page has a description section in the layout that will always be empty for pipeline-sourced tools.
- No breadcrumb navigation back to program pages.
- No related tools section.

---

### Voting System — COMPLETE

**What works:** `POST /api/vote` → `toggleVote()` correctly implements toggle semantics (delete if exists, insert if not). Fingerprinting is reasonable: SHA-256(secret + cookie_value). Rate limiting via Redis sorted-set (20 votes/min/IP). Client-side optimistic update in `vote-button.tsx` with `useTransition`. VoteCount is re-counted from DB after each toggle, then denormalized into `tools.popularityScore`. The UNIQUE constraint on `(toolId, voterFingerprint)` prevents double-voting at DB level even if rate limit fails.

**Gaps:**
- The vote cookie (`tp_vid`) is expected to be set by the client, but the vote API response doesn't include a `Set-Cookie` header. The client component in `vote-button.tsx` doesn't set a cookie either. The fingerprint code has a fallback to UA+IP for cookie-less users, but the cookie is never actually written. This means users who clear cookies lose their vote association — they can re-vote the same tool, with only the IP fallback as a (weak) guard. **This is the single biggest vulnerability in the voting system.**
- `popularityScore` is vote count only. Click activity is not factored in despite the comment claiming it would be.

---

### GitHub Link Handling — COMPLETE

**What works:** GitHub URLs are detected during extraction (`extract.ts`), enriched via GitHub API (`github.ts` → `fetchGitHubRepo`), stored as `linkType: 'github'` in `tool_links`, and displayed prominently in tool cards and detail pages. The freshness system checks GitHub push activity to set `freshnessState`.

**Gap:** The `isBroken` field on `tool_links` is in the schema but **never written to** by any link-health checker. There's no dead-link detection anywhere in the codebase.

---

### Tool Ingestion Pipeline — PARTIAL

Covered in detail in §5. Summary:
- Crawl connectors: COMPLETE (fta_tools, volunteer_systems, github_topics, awesome_list)
- Extraction: COMPLETE
- Deduplication: PARTIAL (URL-exact works; name-similarity not implemented; hostname match has commented-out intent)
- AI Classification: COMPLETE
- Publishing: COMPLETE but has a hardcoded `sourceType` bug
- Submission-to-tool linkage: BROKEN (see §5, §9)

---

### Submission Flow — PARTIAL

**What works:** `POST /api/submit` → `createSubmission()` records the URL, rate-limits by IP (5/hr via Redis), enqueues a BullMQ submission job, and returns a user-facing message. The submit form (`submit-form.tsx`) handles success/error states. The admin submissions page shows pipeline log entries, tabs by status, and supports re-queue/reject/mark-review actions.

**What's broken:**
- **Submissions are never linked to their resolved tool.** After `processSubmissionJob()` creates a `crawl_candidates` row and enqueues an `enrich` job, the submission record's `resolvedToolId` is never updated when the enrich job runs and calls `publishCandidate()`. The submission stays in `processing` status with a stale log entry. Admin has no way to trace "this submission led to tool X."
- `Turnstile` env vars exist in `.env.example` but the submit form has no CAPTCHA integration — spam protection is rate-limit-only.
- No user-facing "check submission status" endpoint or page. A user who submits gets one message and then has no way to follow up.

---

### Admin Dashboard — PARTIAL

#### Overview page — COMPLETE
All 6 stat cards render correctly with real data. Recent crawl jobs table is functional. No bugs found.

#### Tools page (list) — COMPLETE
Paginated (50/page), tabbed by status, shows all relevant fields. Links to edit page. Works.

#### Tool edit page — COMPLETE (with limitation)
Full form: name, summary, description (textarea), toolType, status, freshnessState, vendorName, flags, programs, roles, functions, links (homepage/github/docs). Quick status buttons work. One limitation: **only 3 link types are editable** (homepage, github, docs). Other link types in `tool_links` (changelog, issues, video, source, other) are preserved during save but cannot be viewed or edited in the admin UI.

#### Candidates page — COMPLETE
Tabbed by status, shows AI classification tags, confidence bar, approve/suppress buttons. `approveCandidate()` correctly calls `adminPublishCandidate()` which skips the confidence threshold.

#### Submissions page — PARTIAL
Shows pipeline log, status tabs, action buttons. **But:** submissions stay in `processing` state after the worker finishes (see §5). Admin cannot tell if a submission was auto-published because `resolvedToolId` is never set.

#### Analytics page — PARTIAL (BUG)
Fetches `topQueries`, `zeroResultQueries`, and `topClicked` from DB. **Renders only the first two.** The `topClicked` variable is computed but never passed to any rendered component in `admin/analytics/page.tsx`. This is a straight oversight — the data is there but not displayed.

#### Missing pages — MISSING
- **Crawl Jobs page:** Nav link exists in `admin/layout.tsx` but no `app/admin/crawl-jobs/` route or page exists. The link 404s.
- **Sources page:** Nav link exists but no `app/admin/sources/` route exists.

---

### Analytics — PARTIAL

**What works:** Click events recorded on link click (client-side fetch to `/api/click`). Search events recorded after search (fire-and-forget). Admin analytics page shows top queries and zero-result queries.

**What's broken/missing:**
- `sessionId` is accepted by `recordSearchEvent()` and `recordClickEvent()` but **never passed at call sites**. All analytics records have `NULL sessionId`. Cannot correlate search → click behavior.
- `topClicked` data is fetched but not rendered in analytics UI (see above).
- No time-series view of searches or votes. The 7-day window is fixed.
- No vote-per-tool breakdown in analytics.
- Click events from the tool detail page call `trackClick()` which hits `/api/click`. The API calls `recordClickEvent()` which does NOT verify that the `toolId` exists — a malicious request with a fake UUID will insert garbage rows.

---

## 4. Data Model Audit

### Tables

| Table | Rows Written? | Rows Read? | Notes |
|-------|-------------|-----------|-------|
| `tools` | Yes | Yes | Core table. All fields used except `description` (never set by pipeline). |
| `tool_programs` | Yes | Yes | Correctly used for filtering/enrichment. |
| `tool_audience_primary_roles` | Yes | Yes (detail page) | Not used in search filtering (filter param silently dropped). |
| `tool_audience_functions` | Yes | Yes (detail page) | Not used in search filtering. |
| `tool_links` | Yes | Yes | `isBroken` column never written. `lastCheckedAt` never written. |
| `programs` | Seed only | Yes | 3 rows (frc/ftc/fll). Stable. |
| `audience_primary_roles` | Seed only | Yes | 5 roles. Stable. |
| `audience_functions` | Seed only | Yes | 14 functions. Stable. |
| `tool_votes` | Yes | Yes (count + toggle) | Toggle logic correct. Cookie not set by server. |
| `tool_click_events` | Yes | Yes (admin only) | No sessionId. No toolId validation. |
| `search_events` | Yes | Yes (admin only) | No sessionId. |
| `submissions` | Yes | Yes (admin) | `resolvedToolId` never set by pipeline. |
| `tool_sources` | Yes | **Never read** | Written by publish and admin publish. Never surfaced in any UI or API query. |
| `tool_updates` | Yes | **Never read** | Written by freshness job. Not surfaced in UI. The freshness signal is used to compute `freshnessState` inline, so the table functions as an audit log with no consumer. |
| `crawl_jobs` | Yes | Yes (admin overview) | `stats` field cast as `any` in admin page (`job.stats as any`). |
| `crawl_candidates` | Yes | Yes (admin candidates) | `jobId` FK is null for submission-sourced candidates. |

### Missing Fields / Inconsistencies

1. **`tools.description` is never populated by the pipeline.** The column exists, admin can set it manually, but `publishCandidate()` (`worker/src/pipeline/publish.ts:72`) and `adminPublishCandidate()` (`web/lib/admin/publish-candidate.ts:69`) never set it. Every auto-published tool has `NULL` description.

2. **`tools.popularityScore` is only votes, despite comments suggesting otherwise.** The vote handler (`lib/voting/vote.ts:47`) says "click events contribute separately" but there is no code that updates `popularityScore` based on clicks.

3. **`tool_links.isBroken` and `tool_links.lastCheckedAt`** are in the schema but have no writer anywhere in the codebase. Link health checking is completely absent.

4. **`submissions.resolvedToolId`** is a FK to `tools` but is only set when `processSubmissionJob` detects a pre-existing duplicate. It's never set when the pipeline creates a new tool from the submission.

5. **`publish.ts` hardcodes `sourceType: 'fta_tools'`** on line 107: `sourceType: 'fta_tools', // overridden by enrich job if needed`. The enrich job does not override it. Tools discovered by `github_topics` or `awesome_list` or user submissions will have incorrect source attribution in `tool_sources`.

6. **`crawl_candidates.jobId`** is nullable, but when a candidate is created from a submission (`processSubmissionJob`), the jobId is never set. This is acceptable but means the candidate has no traceability back to the source submission either.

### Over-Engineering

- `tool_updates` table stores individual GitHub activity signals. Given that `freshnessState` is computed inline in the freshness job and written directly to `tools`, the `tool_updates` table is a pure audit log with no consumer. It grows unboundedly with no value until a consumer is built.
- The audience taxonomy (14 functions × 5 roles) is rich and well-designed but completely absent from search filtering (params silently dropped) and the program pages don't use it at all for section breakdowns.

---

## 5. Ingestion Pipeline Audit

Full flow: **submission → crawl → extract → classify → dedupe → publish**

### Stage 1: Submission / Crawl Trigger

**Submission path:** `POST /api/submit` → `createSubmission()` → `submissions.add('process-submission', { submissionId })` → `processSubmissionJob()`.

**Crawl path:** Recurring BullMQ scheduler (defined in `worker/src/index.ts`) enqueues `processCrawlJob()` every 6h/12h/24h. `processCrawlJob()` creates a `crawl_jobs` record, instantiates a connector, iterates candidates, canonicalizes URLs, and enqueues individual `enrich` jobs.

**Status:** Structurally complete and correct. The scheduler uses `upsertJobScheduler` which is idempotent on restart. Rate-limiting (`delay()`) is implemented in connectors.

**Gap:** `crawl_jobs.stats` is cast as `(job.stats as any).discovered` in the admin UI, indicating the stats shape is not type-safe.

---

### Stage 2: Extract

**Location:** `worker/src/pipeline/extract.ts` — `extractMetadata(url)` and `canonicalizeUrl(url)`.

**What it does:**
- GitHub URLs → GitHub API (avoids HTML scraping noise)
- Other URLs → `politeFetch` (15s timeout, custom UA) + `node-html-parser`
  - Title: `og:title` > `<title>`
  - Description: `og:description` > `meta[name=description]`
  - GitHub link detection: regex `github.com/owner/repo`
  - Keywords from `meta[name=keywords]`
- `canonicalizeUrl`: strips UTM params, trailing slash, lowercases hostname.

**Status:** Complete and reasonable.

**Gap:** No JavaScript rendering. Tools that require JS to render meaningful content (e.g., SPAs) will return empty/minimal metadata. The quality gate in `processEnrichJob` (title < 3 chars or description < 10 chars → suppress) will silently discard these.

---

### Stage 3: Deduplicate

**Location:** `worker/src/pipeline/deduplicate.ts` — `checkDuplicate(canonicalUrl, title?)`.

**Three strategies:**
1. Exact URL match in `tool_links` → `isDuplicate: true` ✅
2. Same `canonicalUrl` in `crawl_candidates` → `isDuplicate: true` ✅
3. Hostname match in `tool_links` → `isDuplicate: false` but sets `matchedToolId` ⚠️

**Bugs:**
- **Name similarity deduplication is completely absent.** The file's top comment says "Strategy: URL normalization first, then name similarity check." The `method: 'name_similarity'` type is defined. There is zero implementation. Two different URLs for the same tool (e.g., a GitHub repo and its companion website) will not be detected as duplicates.
- **The hostname check (strategy 3) returns `isDuplicate: false`** intentionally, but the comment says "same domain might be a different tool." This is logically correct but means `github.com/team/tool` and `github.com/team/tool-docs` will pass through. Since GitHub URL format is normalized to `github.com/owner/repo`, this is less of an issue there, but for multi-page websites it will create duplicate candidates.
- **`title?` parameter is accepted but unused.** The function signature accepts a title for name-similarity matching, but since that code doesn't exist, it's dead parameter.

---

### Stage 4: Classify

**Location:** `worker/src/pipeline/classify.ts` — `classifyCandidate(metadata, url)`.

**What it does:** Calls `claude-haiku-4-5-20251001` with a structured prompt. Input: URL, title, description, keywords, hasGithub. Output JSON: `{ toolType, programs[], audienceRoles[], audienceFunctions[], isRookieFriendly, isOfficial, isVendor, summary, confidence, reasoning }`. Falls back to `{ confidence: 0.5 }` if no API key set.

**Status:** Structurally complete. The prompt is reasonable and the fallback is safe.

**Gaps:**
- No validation that the AI's JSON output contains valid enum values (e.g., `programs` could contain `"frc_robot"` instead of `"frc"`). If Claude returns an unexpected value, `inArray(programs.slug, programSlugs)` in `publishCandidate` will simply not find the program and the tool will be published with no program association — silently.
- The `confidence: 0.5` fallback when no API key is set will cause all such candidates to be suppressed (threshold is 0.7). But in `processEnrichJob`, the fallback is never mentioned — there's no log warning that the API key is missing.
- `claude-haiku-4-5-20251001` is hardcoded. A model deprecation will break the pipeline silently until classification errors surface.

---

### Stage 5: Publish

**Location:** `worker/src/pipeline/publish.ts` — `publishCandidate(candidateId)`.

**What it does:** If `confidence >= 0.7`, builds a slug from title, inserts tool record, inserts homepage + GitHub links, links programs/roles/functions, records `tool_sources`, marks candidate `status: 'published'`.

**Bugs:**
1. **`sourceType` is hardcoded to `'fta_tools'`** (line 107). All auto-published tools have incorrect source attribution regardless of actual connector.
2. **`publishCandidate` is called from `processEnrichJob` after setting `candidate.status = 'pending'` on line ~50 in `enrich.ts`.** Then `publishCandidate` sets it to `'published'`. This double-write is harmless but confusing — the candidate briefly transitions pending → published in the same job.
3. **`description` is never set.** Only `summary` (truncated to 300 chars from either AI summary or raw description) is set. The `tools.description` column is always NULL for pipeline tools.
4. **No transaction.** The publish function does ~8 separate DB inserts. If any insert fails mid-way, the tool record exists but is partially linked (e.g., no programs, no source record). There is no rollback.

---

### ~~Stage 6: Submission → Tool Traceability (BROKEN)~~ ✅ Fixed

~~This is the most significant pipeline gap.~~

`EnrichJobPayload` now includes `submissionId?`. `processSubmissionJob` passes it when enqueueing the enrich job. `processEnrichJob` updates the submission record at every outcome: published → `status='published', resolvedToolId=toolId`; low confidence → `status='needs_review'`; quality gate fail → `status='needs_review'`.

---

## 6. Search & Ranking Audit

### How Search Works

`GET /api/search?q=&program=&page=` → `searchTools(params)` in `lib/search/search.ts`.

Pure PostgreSQL full-text search. No Elasticsearch, no external service.

**Main query:**
```sql
WHERE status = 'published'
  AND (to_tsvector('english', name || ' ' || summary || ' ' || description) @@ plainto_tsquery('english', $query)
       OR name ILIKE '%query%')
  [AND EXISTS (program subquery)]
  [AND toolType = $type]
  [AND isOfficial = true]
  [AND isRookieFriendly = true]
ORDER BY rank_score DESC
LIMIT 20 OFFSET n
```

**Ranking formula:**
```
rank_score =
  ts_rank_cd(tsvector, tsquery) * 1.0    -- full-text rank
  + exact_title_boost (0.5)               -- exact name match
  + program_boost (0.4)                   -- tool in filtered program
  + freshness_decay (0–0.2)              -- active=0.2, stale=0.1
  + official_boost (0.3)                 -- isOfficial=true
  + popularity_norm (0–0.3)              -- min(popularityScore/1000, 1) * 0.3
```

### Ranking Issues

1. **`TYPE_WEIGHTS` is defined but not applied.** `web_app=1.0`, `calculator=1.0`, `resource=0.35`, etc. are defined in a TypeScript constant that is never referenced in the SQL. The formula comment at the top of the file lists "type_weight * 0.15" as a component but the actual SQL expression doesn't include it.

2. ~~**`sort` parameter is silently ignored.**~~ ✅ Fixed — `sort=popular` → `ORDER BY popularityScore DESC`, `sort=updated` → `ORDER BY lastActivityAt DESC NULLS LAST`, default → rank score.

3. **`audienceRole` and `audienceFunction` filter params are silently dropped.** They're read from URL params in `search/page.tsx` and passed to `searchTools()`, but inside `searchTools()` there is no condition added for them. The filter chips for audience (if they were ever added to `SearchFilters`) would do nothing.

4. **`popularityScore` is capped at 1000 for normalization** (`min(popularityScore / 1000.0, 1.0) * 0.3`). With only 25 seed tools and limited user traffic, most tools will have popularityScore near 0, making this term nearly inert. The cap is premature optimization.

5. **No GIN index on the tsvector.** The schema creates the tsvector for ranking inline in the query (`to_tsvector('english', ...)`) but this is computed at query time. A stored GIN index (`CREATE INDEX ON tools USING gin(to_tsvector('english', name || ...))`) is defined in the schema via Drizzle but needs to be verified as actually applied in migrations.

6. **Pagination total count is a second round-trip.** After fetching the page of results, a separate `SELECT count(*) FROM tools WHERE ...` runs with the same conditions. This is a standard N+1 pattern for pagination and is acceptable, but the count could be inaccurate if rows are inserted between the two queries.

### Search Strengths

- The use of `ts_rank_cd` (cover density) is appropriate for multi-word queries.
- ILIKE fallback ensures single-word exact matches are never missed.
- Post-query enrichment (programs, GitHub links, vote counts) via `inArray` is efficient — 3 queries for the whole page rather than N queries.
- Program filter uses an EXISTS subquery rather than a JOIN, avoiding result duplication.

---

## 7. UX / Product Audit

### What the User Sees

**Homepage:** Clean hero, large search, 7 quick-search chips, program cards, 4 tool sections. Good first impression. But if the database has few tools (e.g., just seed data), sections like "Recently Updated" may be empty and the layout looks sparse.

**Search:** Search bar in header (md+ screens) and on the /search page. Filter chips are visually compact and togglable. Result count shown. Pagination at bottom. Tool cards show name, badges, summary, freshness, vote button.

**Tool Detail:** Two-column layout. Prominent links in sidebar. Programs, audience metadata displayed. Vote button. Freshness chip with relative date. Good density.

**Submit:** Simple URL + note form. Turnstile placeholder not active. Success message after submit.

**Program pages (FRC/FTC/FLL):** Colored hero, top tools grid, conditional rookie/official sections.

### Flow Problems

1. ~~**Searching from a program page loses program context.**~~ ✅ Fixed — `SearchBar` now accepts `defaultProgram` prop; `ProgramPage` passes the program slug; it's appended to the search URL when not already present.

2. ~~**"See all" links for Trending and Recently Updated don't actually sort.**~~ ✅ Fixed — sort param is now applied in `searchTools()`.

3. ~~**Vote cookie not set.**~~ ✅ Fixed — `resolveVoterIdentity()` generates a UUID on first vote; the `/api/vote` response includes `Set-Cookie: tp_vid=...` when no cookie existed.

4. **Submissions go into a black hole.** After submitting, users see "Thanks!" but have no way to know if the tool was added. The pipeline now updates the submission status, but there's still no user-facing status page. *(P2)*

5. **Empty states are minimal.** No "Did you mean...?" suggestions. *(P2)*

6. **No breadcrumbs or "back to program" navigation** on tool detail pages. *(P2)*

7. ~~**Admin crawl jobs page 404s.**~~ ✅ Fixed — `/admin/crawls` and `/admin/sources` pages created.

8. ~~**Admin analytics missing top-clicked table.**~~ ✅ Fixed — `topClicked` now joins tool names and renders a third `<AnalyticsTable>`.

### Discoverability Gaps

- No tag-cloud or browse-by-category on homepage.
- The audience taxonomy (roles, functions) is invisible to the user — there's no UI to filter by "I'm a programmer" or "I do scouting."
- No tool count shown on program cards (e.g., "47 FRC tools").
- No "what's new" indicator on tool cards (e.g., "Added 3 days ago").

---

## 8. Testing & Reliability Audit

### Current Test Coverage

**Zero tests exist anywhere in the codebase.** No unit tests, no integration tests, no E2E tests. `package.json` scripts have no `test` script defined at the root or app level.

### What Should Be Tested

#### Unit Tests (Vitest / Jest)

| Function | File | Why |
|----------|------|-----|
| `canonicalizeUrl()` | `worker/src/pipeline/extract.ts` | UTM stripping, trailing slash, protocol normalization — many edge cases |
| `checkDuplicate()` | `worker/src/pipeline/deduplicate.ts` | Core correctness of each strategy |
| `getVoterFingerprint()` | `web/lib/voting/fingerprint.ts` | Cookie fallback, hash stability |
| `toggleVote()` | `web/lib/voting/vote.ts` | Toggle logic (add/remove), popularityScore update |
| `rankScore` computation | `web/lib/search/search.ts` | Verify weights produce expected ordering |
| `classifyCandidate()` fallback | `worker/src/pipeline/classify.ts` | Fallback when no API key |
| Slug generation in `publishCandidate()` | `worker/src/pipeline/publish.ts` | Uniqueness loop, special chars |

#### Integration Tests (against real DB)

| Flow | Priority |
|------|---------|
| Submit URL → mark duplicate if already exists | HIGH |
| Submit URL → extract → classify → publish → tool visible in search | HIGH |
| Vote toggle: add vote, re-vote = remove, re-vote = add | HIGH |
| Admin approve candidate → tool appears in search | HIGH |
| Search with program filter returns only program-matched tools | HIGH |
| Search with `sort=popular` returns tools ordered by popularityScore | MEDIUM (currently broken) |
| Freshness job updates `freshnessState` and `lastActivityAt` | MEDIUM |
| Admin `saveTool` correctly syncs all junction tables | MEDIUM |
| Rate limiting: >20 votes in 60s should 429 | MEDIUM |

#### Manual Test Flows

1. Full happy path: Submit a real GitHub URL → confirm worker processes it → find tool in search
2. Submit a duplicate URL → confirm "already listed" response
3. Vote on a tool, reload page, confirm vote state persists (currently broken — will fail)
4. Search "scouting" → apply FRC filter → confirm results match
5. Click tool link → check admin analytics clicks increment
6. Admin: approve a candidate → confirm tool appears in public search
7. Admin: change tool status to `suppressed` → confirm tool disappears from search
8. Crawl job trigger: manually trigger a crawl via BullMQ → watch admin overview

---

## 9. Critical Bugs & Blockers

Ranked by user impact. ✅ = fixed in Session 1 (2026-04-08).

### ~~#1 — Vote State Not Persisted (Cookie Never Set)~~ ✅ Fixed

`fingerprint.ts` now exports `resolveVoterIdentity()` which generates a UUID on first use. The `/api/vote` response sets `Set-Cookie: tp_vid=<uuid>` when no cookie existed on the request.

---

### ~~#2 — Homepage Vote Counts Always Show 0~~ ✅ Fixed

`enrichTools()` in `lib/queries/tools.ts` now runs a parallel vote count query and maps results by toolId. No more hardcoded `voteCount: 0`.

---

### ~~#3 — Sort Parameters Silently Ignored~~ ✅ Fixed

`searchTools()` now builds `orderBy` from the `sort` param: `popular` → `desc(popularityScore)`, `updated` → `lastActivityAt desc nulls last`, default → `rankScore desc`.

---

### ~~#4 — Submissions Never Resolved to Tools~~ ✅ Fixed

`EnrichJobPayload` now carries `submissionId?`. `processEnrichJob` calls `resolveSubmission()` at every outcome branch (published / needs_review).

---

### #5 — `TYPE_WEIGHTS` Defined But Not Applied in Ranking *(P1)*

**File:** `apps/web/lib/search/search.ts:9-19`  
**Problem:** Dead code constant. SQL rankScore doesn't include type weight.

---

### ~~#6 — `topClicked` Analytics Not Rendered~~ ✅ Fixed

`getAnalytics()` now joins tool names into the topClicked query. A third `<AnalyticsTable>` renders "Top Clicked Tools" in the analytics page JSX.

---

### ~~#7 — Program Page Search Loses Program Context~~ ✅ Fixed

`SearchBar` accepts `defaultProgram` prop. When no `program` param exists in the current URL, it appends `&program=<value>` to the search navigation.

---

### #8 — `publish.ts` Hardcodes `sourceType: 'fta_tools'` *(P1)*

**File:** `apps/worker/src/pipeline/publish.ts:107`  
**Problem:** Every auto-published tool record has `sourceType: 'fta_tools'` in `tool_sources` regardless of which connector (github_topics, awesome_list, volunteer_systems, submission) discovered it.  
**Impact:** `tool_sources` data is incorrect for most tools. Admin cannot trace tool provenance. Source attribution is meaningless.

---

### ~~#9 — Admin Navigation Links 404~~ ✅ Fixed

`/admin/crawls/page.tsx` and `/admin/sources/page.tsx` created. Crawls page shows the last 50 crawl jobs with connector, status, timing, stats, and error. Sources page shows `tool_sources` joined with tool names.

---

### #10 — `reindexQueue` Worker Missing

**File:** `apps/worker/src/queues.ts`, `apps/worker/src/index.ts`  
**Problem:** `reindexQueue` is defined. `ReindexPayload` type exists. No processor function exists and no worker is registered in `index.ts` for this queue. Any job added to this queue will sit in Redis indefinitely.  
**Impact:** The reindex feature is completely non-functional. If any code path adds a reindex job, it silently stalls.

---

## 10. MVP Gap Analysis

### What Is Required for MVP v1

A usable MVP needs:
1. Users can discover tools (search, browse)
2. Users can see accurate information (vote counts, freshness)
3. Users can vote and their vote persists
4. Admin can process the ingestion queue reliably
5. Admin can see accurate pipeline state
6. Core navigation works

### Current State vs MVP Requirements

| Requirement | Status | Gap |
|------------|--------|-----|
| Search tools by keyword | ✅ Works | — |
| Filter by program | ✅ Works | — |
| Sort by popularity / recency | ✅ Fixed | — |
| Accurate vote counts on homepage | ✅ Fixed | — |
| Vote persists across sessions | ✅ Fixed | Cookie now set on first vote |
| Program page search preserves context | ✅ Fixed | — |
| Tool detail page | ✅ Works | Description always null *(P1)* |
| Submit tool URL | ✅ Works | No CAPTCHA, no status tracking *(P2)* |
| Admin: see tool pipeline state | ✅ Fixed | Submissions now resolve to tools |
| Admin: crawl jobs page | ✅ Fixed | `/admin/crawls` page created |
| Admin: click analytics | ✅ Fixed | Top Clicked Tools table now rendered |
| Ingestion pipeline runs | ✅ Works | Source attribution wrong |
| Freshness tracking | ✅ Works | Tool updates table unread |

### Missing for MVP

1. Fix vote cookie persistence
2. Fix `enrichTools()` voteCount
3. Implement sort in `searchTools()`
4. Fix program page search bar
5. Fix submission-to-tool linkage
6. Either create or remove broken admin nav pages
7. Render top-clicked table in analytics
8. Fix `sourceType` in `publish.ts`

### Nice-to-Have (Post-MVP)

- Name-similarity deduplication
- Link health checker (write `isBroken`)
- Tool description population from pipeline
- Audience role/function search filtering
- CAPTCHA on submit form
- Session ID tracking in analytics
- Related tools section on detail page
- "Added X days ago" on tool cards

---

## 11. Prioritized Roadmap

### P0 — Fix Immediately (Broken Core Functionality)

**P0-1: Fix vote cookie persistence**  
`apps/web/app/api/vote/route.ts` — After `toggleVote()` succeeds, issue `Set-Cookie: tp_vid=<uuid>; Max-Age=63072000; HttpOnly; Path=/; SameSite=Lax` in the response. Generate a UUID v4 if no cookie exists on the request. Update `getVoterFingerprint()` to hash this value consistently.

**P0-2: Fix homepage vote counts**  
`apps/web/lib/queries/tools.ts` — In `enrichTools()`, add a parallel query for vote counts using `inArray(toolVotes.toolId, ids)` grouped by toolId, same pattern as the search function. Replace hardcoded `voteCount: 0` with actual counts.

**P0-3: Implement sort in `searchTools()`**  
`apps/web/lib/search/search.ts` — Add a switch on the `sort` param:
- `sort=popular` → `ORDER BY popularityScore DESC`
- `sort=updated` → `ORDER BY lastActivityAt DESC NULLS LAST`
- default → `ORDER BY rankScore DESC`

**P0-4: Fix program page search bar**  
`apps/web/components/program/program-page.tsx` — Pass `defaultProgram={program}` to `<SearchBar>`. Update `SearchBar` to accept a `defaultProgram` prop and include it as a hidden input in the form (or append `&program=frc` to the action URL).

**P0-5: Fix submission-to-tool linkage**  
Add `submissionId?: string` to `EnrichJobPayload` type. In `processSubmissionJob`, include `submissionId` when enqueuing the enrich job. In `processEnrichJob`, after `publishCandidate()` succeeds, update `submissions SET status='published', resolvedToolId=toolId WHERE id=submissionId`.

**P0-6: Fix broken admin nav**  
Either create stub pages at `app/admin/crawl-jobs/page.tsx` and `app/admin/sources/page.tsx`, or remove the nav links from `app/admin/layout.tsx`.

**P0-7: Render top-clicked analytics table**  
`apps/web/app/admin/analytics/page.tsx` — Add a third `<AnalyticsTable>` for `data.topClicked`. Since the table only has `toolId` (UUID), also join tool names — requires updating `getAnalytics()` to JOIN tools on toolId.

---

### P1 — Before Launch

**P1-1: Fix `sourceType` in `publishCandidate()`**  
`apps/worker/src/pipeline/publish.ts:107` — Pass the connector name (or a sourceType) through `CrawlJobPayload` → `EnrichJobPayload` → `publishCandidate()`. The `EnrichJobPayload` should include a `sourceType` field, set by the crawl job.

**P1-2: Apply `TYPE_WEIGHTS` in ranking**  
`apps/web/lib/search/search.ts` — Add a SQL CASE expression for type weight in `rankScore`. Map each `toolType` to its weight and multiply by 0.15 as documented.

**P1-3: Fix audience filter params in search**  
`apps/web/lib/search/search.ts` — Add WHERE EXISTS conditions for `audienceRole` and `audienceFunction` params using EXISTS subqueries against `tool_audience_primary_roles` and `tool_audience_functions`. Update `SearchFilters` component to expose these chips.

**P1-4: Fix `description` in pipeline**  
`apps/worker/src/pipeline/publish.ts` — Use a longer AI-generated description (ask Claude for a 2-3 sentence description) or fall back to the raw extracted description for the `description` field. Do not leave it NULL.

**P1-5: Add transaction to `publishCandidate()`**  
Wrap all inserts in `publishCandidate()` in a single DB transaction to prevent partial publishes.

**P1-6: Validate AI output enums**  
`apps/worker/src/pipeline/classify.ts` — After parsing Claude's JSON response, validate `programs`, `toolType`, `audienceRoles`, `audienceFunctions` against known valid slugs. Log and discard invalid values rather than silently dropping them from DB inserts.

**P1-7: Add sessionId to analytics**  
Generate a session ID (random UUID stored in a short-lived cookie or `sessionStorage`) client-side. Pass it to `/api/search` and `/api/click` to enable session-level analytics correlation.

---

### P2 — Later / Post-Launch

**P2-1: Implement name-similarity deduplication**  
`apps/worker/src/pipeline/deduplicate.ts` — Add trigram similarity check using `pg_trgm`'s `similarity(name, $title) > 0.7` against existing tool names when title is provided.

**P2-2: Implement link health checker**  
Add a new BullMQ job type that periodically fetches tool links and writes `isBroken=true` / `lastCheckedAt=now()` to `tool_links`. Schedule weekly. Surface `isBroken` badge in tool cards/admin.

**P2-3: Add `reindexQueue` worker**  
`apps/worker/src/index.ts` — Implement `processReindexJob()` that rebuilds tsvector indexes for updated tools. Register the worker.

**P2-4: Tool count on program cards**  
`apps/web/components/program/program-cards.tsx` — Add a SQL query counting published tools per program. Display count on each program card.

**P2-5: Surface `tool_sources` in admin**  
`apps/web/app/admin/tools/[id]/page.tsx` — Add a "Sources" section showing `tool_sources` rows for the tool. Currently this table is write-only.

**P2-6: Turnstile CAPTCHA on submit**  
Integrate Cloudflare Turnstile. The env vars and install comments exist. Wire up the `<TurnstileWidget>` in `submit-form.tsx` and validate the token server-side in `POST /api/submit`.

**P2-7: Time-series analytics**  
Replace the flat 7-day window in admin analytics with a day-by-day breakdown. Add vote trends, submission rate over time.

---

## 12. Suggested Next Actions

**Day 1 (4-6 hours): Fix the 7 P0 bugs**

Work through these in order — each is a focused, isolated change:

1. **Vote cookie (P0-1):** ~30 min. Modify `apps/web/app/api/vote/route.ts` to set `tp_vid` cookie on response. Add cookie generation logic.

2. **Homepage vote counts (P0-2):** ~20 min. Add vote count parallel query in `enrichTools()` in `apps/web/lib/queries/tools.ts`. Copy pattern from `searchTools()`.

3. **Sort param (P0-3):** ~30 min. Add 3-case switch to `searchTools()` ORDER BY. Test with `/search?sort=popular` and `/search?sort=updated`.

4. **Program search bar (P0-4):** ~20 min. Add `defaultProgram` prop to `SearchBar`. Append it as hidden form field. Pass from `ProgramPage`.

5. **Submission linkage (P0-5):** ~45 min. Extend `EnrichJobPayload` type. Update `processSubmissionJob` to include `submissionId`. Update `processEnrichJob` to update submission record after publish.

6. **Admin nav (P0-6):** ~15 min. Remove or stub the two dead nav links.

7. **Top-clicked analytics (P0-7):** ~30 min. Update `getAnalytics()` to JOIN tool names. Add third `<AnalyticsTable>` in JSX.

**Day 2 (4-6 hours): P1 quality fixes + setup for ongoing work**

1. **Fix `sourceType` (P1-1):** ~45 min. Thread `sourceType` through job payloads.

2. **Apply type weights (P1-2):** ~30 min. Add CASE expression to `rankScore` SQL.

3. **Validate AI output (P1-6):** ~30 min. Add enum validation in `classify.ts`.

4. **Add DB transaction to `publishCandidate` (P1-5):** ~30 min. Wrap inserts in `db.transaction()`.

5. **Write first integration tests (§8):** ~90 min. At minimum: test vote toggle (add/remove/add), test search program filter, test duplicate submission detection. Use a test database.

6. **Manually run the ingestion pipeline end-to-end.** Submit a real FRC tool URL via the form. Watch the worker logs. Verify the tool appears in search. Check the admin submissions page reflects the resolved tool.

---

*This document was generated from direct code analysis. All file references are to the repository root at `/mnt/storage/NextCloud/Robots/The-Tool-Pit`. Verify against current code state before acting on any finding.*
