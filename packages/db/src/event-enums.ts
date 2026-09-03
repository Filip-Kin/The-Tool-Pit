/**
 * Off-season event listing enum-like value tuples. Kept in a ZERO-DEPENDENCY
 * module (no drizzle, no db client) so client components can import the value
 * tuples for rendering without dragging the DB client / postgres into the
 * browser bundle. The schema in ./schema/event-listings.ts re-exports these.
 *
 * Same trap the fields vertical hit: a 'use client' file that value-imports
 * from the @the-tool-pit/db barrel pulls postgres (net/tls/fs) into the client
 * bundle and next build dies with "Module not found: net". Import these from
 * the @the-tool-pit/db/event-enums subpath instead.
 */

/** FIRST program the event runs. Matches events.program and FIELD_PROGRAMS. */
export const EVENT_PROGRAMS = ['frc', 'ftc', 'fll'] as const
export type EventProgram = (typeof EVENT_PROGRAMS)[number]

/**
 * The event's own lifecycle, straight off Filip's spreadsheet "Status" column.
 * This is the organiser's state, NOT our moderation state (that is `status`).
 *   tentative  - planning stages (sheet "Pending"), or "happened last year,
 *                unknown if it runs again" (sheet "?"). Field/venue not locked.
 *   confirmed  - field confirmed, it is happening.
 *   completed  - already run this season.
 *   cancelled  - was scheduled, then called off.
 */
export const EVENT_STATUSES = ['tentative', 'confirmed', 'completed', 'cancelled'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/**
 * Whether teams can sign up yet. Sheet "Registration Open?" held No / Yes /
 * Waitlist / a date. A future open date goes in `registrationOpensAt`, a
 * registration deadline in `registrationClosesAt`; this enum is the coarse
 * state a filter chip keys off.
 *   not_open  - not yet open (sheet "No", or a future date).
 *   open      - accepting registrations now.
 *   waitlist  - full, taking a waitlist.
 *   closed    - registration has shut (full, or past).
 *   unknown   - sheet left it blank / "?".
 */
export const REGISTRATION_STATUSES = ['not_open', 'open', 'waitlist', 'closed', 'unknown'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

/** Whether the event is taking volunteer sign-ups. Sheet "Vol Signup Open?". */
export const VOLUNTEER_STATUSES = ['open', 'not_open', 'unknown'] as const
export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number]

/** Moderation state. Only 'published' listings appear publicly. Mirrors fields. */
export const EVENT_LISTING_STATUSES = ['pending', 'published', 'suppressed'] as const
export type EventListingStatus = (typeof EVENT_LISTING_STATUSES)[number]

/** Where the listing came from. */
export const EVENT_LISTING_SOURCES = ['submission', 'seed', 'admin', 'scrape'] as const
export type EventListingSource = (typeof EVENT_LISTING_SOURCES)[number]

/** Review state of a scraped roster snapshot. Only 'approved' shows publicly. */
export const ROSTER_SNAPSHOT_STATUSES = ['pending', 'approved', 'rejected'] as const
export type RosterSnapshotStatus = (typeof ROSTER_SNAPSHOT_STATUSES)[number]

/**
 * Where an event's team list comes from, chosen by the owner.
 *   auto   - we read the roster ourselves: scrape teamListUrl before the event
 *            starts, borrow TBA's after. The default, and everything the roster
 *            refresh job has always done.
 *   manual - the owner typed the team list into the listing form. The refresh
 *            job SKIPS a manual listing entirely, so nothing overwrites a
 *            hand-entered roster. See parseManualRoster and roster-refresh.ts.
 */
export const TEAM_LIST_MODES = ['auto', 'manual'] as const
export type TeamListMode = (typeof TEAM_LIST_MODES)[number]

// ---------------------------------------------------------------------------
// Off-season event DISCOVERY (crawl) enums
//
// Discovery is a separate axis from the tuples above. Everything above
// describes a LISTING a human already owns; everything below describes a LEAD
// a crawler found and nobody has looked at yet.
// ---------------------------------------------------------------------------

/**
 * Where an off-season event lead came from.
 *   tba_offseason - TBA event_type 99 (offseason) / 100 (preseason).
 *   chief_delphi  - a forum thread announcing an event.
 *   seed          - a page a human pointed the crawler at.
 *   admin         - filed by hand from the admin, for the audit trail.
 */
export const EVENT_LISTING_SOURCE_KINDS = ['tba_offseason', 'chief_delphi', 'seed', 'admin'] as const
export type EventListingSourceKind = (typeof EVENT_LISTING_SOURCE_KINDS)[number]

/**
 * Review state of a discovered event lead. NOTHING in this tuple is public:
 * 'published' means a human promoted the lead into an event_listings row, and
 * that row carries its own separate moderation status.
 */
export const EVENT_LISTING_CANDIDATE_STATUSES = [
  'pending',
  'matched',
  'published',
  'suppressed',
  'duplicate',
] as const
export type EventListingCandidateStatus = (typeof EVENT_LISTING_CANDIDATE_STATUSES)[number]
