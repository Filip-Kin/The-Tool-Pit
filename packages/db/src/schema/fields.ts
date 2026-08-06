import { pgTable, uuid, text, integer, real, boolean, doublePrecision, timestamp, index, customType } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

/** Raw binary column (Postgres bytea) for uploaded field photos. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

// ---------------------------------------------------------------------------
// Enum-like value tuples (plain text columns, app-level unions - no pgEnum)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Practice field listings (submission -> admin-approved -> published)
// ---------------------------------------------------------------------------

export const practiceFields = pgTable(
  'practice_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Identity
    /** Host team number, when a team runs the field. */
    teamNumber: integer('team_number'),
    /** Free-text team / organisation name. */
    teamName: text('team_name'),
    /** FIELD_PROGRAMS */
    program: text('program').notNull().default('frc'),
    /** Facility / field name shown on the pin and card. */
    name: text('name').notNull(),

    // Place
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    address: text('address'),
    city: text('city'),
    /** State / province. */
    region: text('region'),
    country: text('country'),

    // Field spec
    /** FIELD_COVERAGE */
    coverage: text('coverage').notNull().default('full'),
    /** FIELD_PERIMETER */
    perimeter: text('perimeter').notNull().default('none'),
    /** FIELD_ELEMENTS */
    elements: text('elements').notNull().default('wood'),
    hasFms: boolean('has_fms').notNull().default(false),
    aprilTags: boolean('april_tags').notNull().default(false),
    /** Ceiling height in feet - matters for shooting games. */
    ceilingHeightFt: real('ceiling_height_ft'),

    // Access
    /** FIELD_AVAILABILITY */
    availability: text('availability').notNull().default('unknown'),
    /** Free-text days/hours the field is open. */
    hours: text('hours'),
    /** How to arrange access (free text - e.g. "email the team, allow a day's notice"). */
    contactInfo: text('contact_info'),
    /** A sign-up / booking / contact link (e.g. a Google Form). */
    contactUrl: text('contact_url'),
    website: text('website'),
    notes: text('notes'),
    /** Serving URL for the uploaded photo (points at /api/fields/photo/<id>) or an external image URL. */
    photoUrl: text('photo_url'),

    // Moderation
    /** FIELD_STATUSES */
    status: text('status').notNull().default('pending'),
    /** FIELD_SOURCES */
    source: text('source').notNull().default('submission'),
    rejectionReason: text('rejection_reason'),

    // Submitter audit (private - admin only)
    submitterName: text('submitter_name'),
    /** How to reach the submitter (email/phone/handle). Never shown publicly. */
    submitterContact: text('submitter_contact'),
    submitterIpHash: text('submitter_ip_hash'),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('practice_fields_status_idx').on(table.status),
    index('practice_fields_program_idx').on(table.program),
    index('practice_fields_team_number_idx').on(table.teamNumber),
    index('practice_fields_created_at_idx').on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Uploaded field photos (in-DB bytea, served via /api/fields/photo/[id]).
// Reviewed by an admin before the field is published.
// ---------------------------------------------------------------------------

export const fieldPhotos = pgTable('field_photos', {
  fieldId: uuid('field_id')
    .primaryKey()
    .references(() => practiceFields.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  data: bytea('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const practiceFieldsRelations = relations(practiceFields, ({ one }) => ({
  photo: one(fieldPhotos, { fields: [practiceFields.id], references: [fieldPhotos.fieldId] }),
}))

export const fieldPhotosRelations = relations(fieldPhotos, ({ one }) => ({
  field: one(practiceFields, { fields: [fieldPhotos.fieldId], references: [practiceFields.id] }),
}))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PracticeField = typeof practiceFields.$inferSelect
export type NewPracticeField = typeof practiceFields.$inferInsert
export type FieldPhoto = typeof fieldPhotos.$inferSelect
export type NewFieldPhoto = typeof fieldPhotos.$inferInsert
