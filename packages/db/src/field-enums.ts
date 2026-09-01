/**
 * Practice-field enum-like value tuples. Kept in a ZERO-DEPENDENCY module (no
 * drizzle, no db client) so client components can import the value tuples for
 * rendering without dragging the DB client / postgres into the browser bundle.
 * The schema in ./schema/fields.ts re-exports these.
 */

/** FIRST program the field is built for. Matches events.program. */
export const FIELD_PROGRAMS = ['frc', 'ftc', 'fll'] as const
export type FieldProgram = (typeof FIELD_PROGRAMS)[number]

/** How much of the field is set up. Drives half-vs-full in the pin colour. */
export const FIELD_COVERAGE = ['full', 'half'] as const
export type FieldCoverage = (typeof FIELD_COVERAGE)[number]

/** What the field perimeter is made of (shown on the card, not in the pin). */
export const FIELD_PERIMETER = ['wood', 'metal', 'none'] as const
export type FieldPerimeter = (typeof FIELD_PERIMETER)[number]

/** Whether the game/scoring elements are shop-built wood or real official pieces. Drives the pin hue. */
export const FIELD_ELEMENTS = ['wood', 'official'] as const
export type FieldElements = (typeof FIELD_ELEMENTS)[number]

/** When the field can be used (timing only - access/arrangement is a separate axis). */
export const FIELD_AVAILABILITY = ['year_round', 'in_season', 'unknown'] as const
export type FieldAvailability = (typeof FIELD_AVAILABILITY)[number]

/** Moderation state. Only 'published' fields appear publicly. */
export const FIELD_STATUSES = ['pending', 'published', 'suppressed'] as const
export type FieldStatus = (typeof FIELD_STATUSES)[number]

/**
 * Where the listing came from. 'scrape' is a field a human promoted out of a
 * practice_field_candidates row, so a reviewer can tell at a glance that the
 * detail on it was read off someone else's post rather than typed by the team
 * that owns the field.
 */
export const FIELD_SOURCES = ['submission', 'seed', 'admin', 'scrape'] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]

// ---------------------------------------------------------------------------
// Practice-field DISCOVERY (crawl) enums
//
// Separate axis from the tuples above: those describe a field a human already
// owns, these describe a lead a crawler found that nobody has looked at.
// ---------------------------------------------------------------------------

/**
 * Where a practice-field lead came from.
 *   chief_delphi - a forum thread offering field time.
 *   seed         - a page a human pointed the crawler at.
 *   admin        - filed by hand from the admin, for the audit trail.
 */
export const FIELD_CRAWL_SOURCE_KINDS = ['chief_delphi', 'seed', 'admin'] as const
export type FieldCrawlSourceKind = (typeof FIELD_CRAWL_SOURCE_KINDS)[number]

/**
 * Review state of a discovered field lead. Nothing here is public: 'published'
 * means a human promoted the lead into a practice_fields row, and that row
 * carries its own separate moderation status.
 */
export const FIELD_CANDIDATE_STATUSES = [
  'pending',
  'matched',
  'published',
  'suppressed',
  'duplicate',
] as const
export type FieldCandidateStatus = (typeof FIELD_CANDIDATE_STATUSES)[number]
