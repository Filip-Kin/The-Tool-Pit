import { pgTable, uuid, text, integer, real, boolean, doublePrecision, timestamp, jsonb, index, customType } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

/** Raw binary column (Postgres bytea) for uploaded field photos. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

// Enum-like value tuples live in ../field-enums (a zero-dependency module) so
// client components can import them without pulling in the DB client. Re-export
// here so `@the-tool-pit/db` consumers still get them from the barrel.
export {
  FIELD_PROGRAMS,
  FIELD_COVERAGE,
  FIELD_PERIMETER,
  FIELD_ELEMENTS,
  FIELD_AVAILABILITY,
  FIELD_STATUSES,
  FIELD_SOURCES,
} from '../field-enums'
export type {
  FieldProgram,
  FieldCoverage,
  FieldPerimeter,
  FieldElements,
  FieldAvailability,
  FieldStatus,
  FieldSource,
} from '../field-enums'

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
// Community edit proposals - anyone can suggest changes to a published field;
// an admin reviews the before/after diff and applies or rejects.
// ---------------------------------------------------------------------------

export const FIELD_EDIT_STATUSES = ['pending', 'applied', 'rejected'] as const
export type FieldEditStatus = (typeof FIELD_EDIT_STATUSES)[number]

/** The editable snapshot a proposal carries (full proposed state of the field). */
export interface FieldEditProposalData {
  name?: string
  teamNumber?: number | null
  teamName?: string | null
  program?: string
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  coverage?: string
  perimeter?: string
  elements?: string
  hasFms?: boolean
  ceilingHeightFt?: number | null
  availability?: string
  hours?: string | null
  contactInfo?: string | null
  contactUrl?: string | null
  website?: string | null
  notes?: string | null
}

export const fieldEditProposals = pgTable(
  'field_edit_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => practiceFields.id, { onDelete: 'cascade' }),
    proposed: jsonb('proposed').$type<FieldEditProposalData>().notNull(),
    /** Submitter's note explaining what changed / why. */
    note: text('note'),
    submitterName: text('submitter_name'),
    submitterContact: text('submitter_contact'),
    submitterIpHash: text('submitter_ip_hash'),
    /** FIELD_EDIT_STATUSES */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('field_edit_proposals_field_id_idx').on(table.fieldId),
    index('field_edit_proposals_status_idx').on(table.status),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const practiceFieldsRelations = relations(practiceFields, ({ one, many }) => ({
  photo: one(fieldPhotos, { fields: [practiceFields.id], references: [fieldPhotos.fieldId] }),
  editProposals: many(fieldEditProposals),
}))

export const fieldEditProposalsRelations = relations(fieldEditProposals, ({ one }) => ({
  field: one(practiceFields, { fields: [fieldEditProposals.fieldId], references: [practiceFields.id] }),
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
export type FieldEditProposal = typeof fieldEditProposals.$inferSelect
export type NewFieldEditProposal = typeof fieldEditProposals.$inferInsert
