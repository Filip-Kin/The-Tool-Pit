# Off-season Events vertical (/events) - working notes

Branch feat/events-vertical, worktree .../ttp-worktrees/events. Do NOT merge/deploy.

## Status: DESIGN DONE, BUILDING

## Design decisions (2026-09-01)

### TBA reuse - what is free vs what is new (VERIFIED against schema)
- `events` table (packages/db/src/schema/events.ts) is synced from TBA. Off-season events
  carry event_type 99 (offseason) / 100 (preseason). `event_teams` holds the roster.
- BUT most Michigan off-season events are NOT in TBA, or only appear AFTER they run with an
  official code. TBA never lists Cancelled/Pending events, and has none of the listing data
  (cost, slots, registration status, volunteer status, venue address, organiser email).
- So: `events` stays the authoritative in/off-season record + final roster. The LISTING is
  its own table (`event_listings`), human-submitted + admin-curated, exactly like fields.
  When a listing matches a TBA event we store its `tbaKey` to borrow the roster/results.
- Off-season emphasis = UPCOMING events with no TBA roster yet, so the fullness signal has
  to come from the event's OWN registration page (the scrape), not TBA.

### Schema (new tables, mirrors practice_fields + grant snapshots)
- **`event_listings`** - the curated listing. Columns map 1:1 to the sheet:
  name; program (frc default); place (lat/lng, venueName, address, city, region, country);
  startDate/endDate (real dates, year resolved); days int (1/2) + parallelDivisions bool
  (the "2x 1" pattern); capacity int (Slots, nullable); costUsd int + costNote (the "$450
  for both days" extras); registrationStatus enum + registrationOpensAt date (the "8/1"
  case); volunteerStatus enum; eventStatus enum (sheet "Status" lifecycle:
  tentative/confirmed/completed/cancelled/unknown); website; registrationUrl;
  chiefDelphiUrl (the "CD Post" case); contactEmail; notes; tbaKey (nullable link to
  authoritative event); plus moderation block copied from practice_fields
  (status pending/published/suppressed, source, rejectionReason, submitter*, 
  submittedByUserId, publishedAt, created/updatedAt).
- **`event_roster_snapshots`** - MONITOR-style scrape output, gated like grants. One row
  per scrape of one event's registration page: eventListingId, sourceUrl, fetchedAt,
  httpStatus, teamCount int, teams jsonb ({number,name?}[]), contentHash, changed bool,
  status (pending/approved/rejected), error. PUBLIC listing shows the latest APPROVED
  snapshot's count/list. First snapshot from a URL is pending; a per-source autoApprove
  flag lets a trusted source skip the queue after the first human approval (still logged).
  RULE honoured: nothing scraped shows publicly until a human approves it once.
- Enums live in a ZERO-DEP module `packages/db/src/event-enums.ts` + subpath
  `@the-tool-pit/db/event-enums` (CRITICAL gotcha from fields: a `'use client'` file must
  not value-import from the db barrel or it drags postgres into the browser bundle).

### Routing / registration
- PATH `/events` on the one host. No new subdomain (DOMAIN RULE). Middleware needs NO change
  for the path itself (paths are native Next routes; middleware only 308s legacy subdomains).
- Register in vertical-switcher.tsx (VerticalKey 'events', Calendar icon) + vertical-links.ts
  + each vertical's MobileNav list. Header/layout mirror app/grants/. Wordmark -> `/events`,
  submit -> `/events/submit` (NOT root-relative `/` - that would hit the tools host).

### Scrape design + what is actually scrapable
- Deterministic first (no AI): fetch the event's registration/teams page, parse a team list
  with node-html-parser + regex for "frc\d+" / a 3-5 digit number next to a team name.
  Verification of specific sites is the NEXT step (curl each event link, see notes below).
- "CD Post" events have no roster page -> no scrape, count stays null.

## Next concrete step
Build `event-enums.ts` + `event_listings`/`event_roster_snapshots` schema, generate migration,
type-check, commit. THEN scaffolding, THEN seed, THEN verify+build scraper.

## 1. Filip's spreadsheet columns (VERIFIED, read 2026-09-01)

Source: Google Sheet "2026 FIM Off-Season Events"
(id 1ZrWGhAR6FkWt-J3VS8XMH-l-PxayRl5Bllkpjo84E68, owned by filipkinjan@gmail.com).
"Last Updated: 8/17". 17 event rows for the 2026 Michigan off-season.

Columns, verbatim, with the actual value shapes seen:
- **Date** - "6/27 - 6/28" (range) or "8/1" (single). Day/month, no year (year implied by sheet).
- **Status** - Cancelled | Completed | Confirmed | Pending | "?"
  Legend on sheet: "?: Happened last year, unknown. Pending: Planning stages.
  Confirmed: Field is confirmed." Cancelled + Completed are lifecycle states too.
- **Name** - e.g. "MARC", "Kettering Kickoff", "Detroit City Championship".
- **Address** - multi-line: venue name THEN street address
  (e.g. "Dundee High School\n130 Viking Drive, Dundee, MI 48131").
- **1 or 2 Day** - "1", "2", or "2x 1" (two separate one-day events same weekend).
- **Slots** - capacity: 40, 32, 24, "2x 32", "?". This is the CAPACITY number.
- **Cost** - "$300", "$250", "." (unknown). Registration fee per team.
- **Registration Open?** - No | Yes | Waitlist | a date ("8/1").
- **Vol Signup Open?** - No | Yes | "?".
- **Event Link** - a URL, or the literal "CD Post" (a Chief Delphi thread, no site).
- **Email** - organiser contact email.
- **Notes** - freeform (scholarships, "$450 for both days", "Only Detroit teams eligible",
  "$200 for second robot", FTC crossover, etc.).

KEY TAKEAWAY: this dataset is RICHER than TBA. It has cost, capacity (slots), registration
status, volunteer status, venue address, and CANCELLED/PENDING events. TBA has none of that
and never lists cancelled/planning-stage events. So the listing needs its own table; TBA is a
supplement (roster + official code) for the events that do get a TBA code.

## 2. Next concrete step
Explore repo: fields vertical shape, events table schema, tba-events connector, grants
candidate/review pipeline. Then write schema + scrape design below.
