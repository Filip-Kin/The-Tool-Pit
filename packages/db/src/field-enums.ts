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
export const FIELD_COVERAGE = ['full', 'half', 'elements_only'] as const
export type FieldCoverage = (typeof FIELD_COVERAGE)[number]

/** What the field perimeter is made of (shown on the card, not in the pin). */
export const FIELD_PERIMETER = ['wood', 'metal', 'none'] as const
export type FieldPerimeter = (typeof FIELD_PERIMETER)[number]

/** Whether the game/scoring elements are shop-built wood or real official pieces. Drives the pin hue. */
export const FIELD_ELEMENTS = ['wood', 'official'] as const
export type FieldElements = (typeof FIELD_ELEMENTS)[number]

/** When the field can be used. */
export const FIELD_AVAILABILITY = ['year_round', 'in_season', 'by_arrangement', 'unknown'] as const
export type FieldAvailability = (typeof FIELD_AVAILABILITY)[number]

/** Moderation state. Only 'published' fields appear publicly. */
export const FIELD_STATUSES = ['pending', 'published', 'suppressed'] as const
export type FieldStatus = (typeof FIELD_STATUSES)[number]

/** Where the listing came from. */
export const FIELD_SOURCES = ['submission', 'seed', 'admin'] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]
