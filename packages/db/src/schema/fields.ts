import { pgTable, uuid, text, integer, real, boolean, doublePrecision, timestamp, jsonb, index, uniqueIndex, customType } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './accounts'

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
    /**
     * Human URL slug, built from the team number and name, e.g.
     * "1234-kettering-practice-field". The public page lives at /fields/<slug>;
     * the UUID id still resolves and 301s to it.
     *
     * STABLE ONCE SET. Generated at insert (uniqueFieldSlug) with a numeric
     * suffix on collision so it is globally unique in this table. A later rename
     * keeps the existing slug, the same rule tools and grants use.
     */
    slug: text('slug').notNull(),
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
    /**
     * The signed-in user who submitted this, when there was one. Sign-in is
     * OPTIONAL here on purpose: anonymous submissions stay open so a mentor
     * without an account can still put their field on the map. Signing in
     * only buys attribution and the ability to find your own submissions.
     */
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Did the submitter say this is theirs to run?
     *
     * TRUE  - they left the "I am only passing this along" box unticked, so
     *         approving this grants them the listing. See
     *         apps/web/lib/listings/submitter-ownership.ts.
     * FALSE - they ticked it. Nothing is granted, ever, from this row.
     * NULL  - submitted before the form asked. Not a refusal, just never asked,
     *         so the claim page still reads their submission as evidence.
     */
    submitterOwns: boolean('submitter_owns'),

    // Outreach (the one-time "we listed you" email; wired for events first, the
    // columns here so the field version is a UI change and not a migration).
    /**
     * When an admin sent the outreach email for this field, or null if never.
     * The "never twice" guard lives on the field, not the outbox row, so it
     * survives the outbox being pruned. A field's public contact is the
     * free-text contactInfo, so the field outreach path has to find an address
     * in it before it can send; that gate lives with the (later) field button.
     */
    outreachSentAt: timestamp('outreach_sent_at', { withTimezone: true }),
    /** The address the outreach went to, recorded for the button and for audit. */
    outreachSentTo: text('outreach_sent_to'),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('practice_fields_slug_idx').on(table.slug),
    index('practice_fields_status_idx').on(table.status),
    index('practice_fields_program_idx').on(table.program),
    index('practice_fields_team_number_idx').on(table.teamNumber),
    index('practice_fields_created_at_idx').on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Uploaded field photos (in-DB bytea, served via /api/fields/photo/[id]).
// A field can have several - a gallery, ordered by sortOrder. Reviewed by an
// admin before the field is published.
// ---------------------------------------------------------------------------

export const fieldPhotos = pgTable(
  'field_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => practiceFields.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
    /** Display order within a field's gallery (ascending; first is the cover). */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('field_photos_field_id_idx').on(table.fieldId)],
)

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
    /** IDs of existing field_photos the submitter proposes removing. */
    removePhotoIds: jsonb('remove_photo_ids').$type<string[]>().notNull().default([]),
    /** Submitter's note explaining what changed / why. */
    note: text('note'),
    submitterName: text('submitter_name'),
    submitterContact: text('submitter_contact'),
    submitterIpHash: text('submitter_ip_hash'),
    /**
     * The signed-in user who submitted this, when there was one. Sign-in is
     * OPTIONAL here on purpose: anonymous submissions stay open so a mentor
     * without an account can still put their field on the map. Signing in
     * only buys attribution and the ability to find your own submissions.
     */
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** FIELD_EDIT_STATUSES */
    status: text('status').notNull().default('pending'),
    /**
     * Why an admin did not apply it. Required by rejectFieldEdit, and the same
     * text the submitter is sent, so "what did we tell them" is a SELECT.
     */
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('field_edit_proposals_field_id_idx').on(table.fieldId),
    index('field_edit_proposals_status_idx').on(table.status),
  ],
)

// ---------------------------------------------------------------------------
// Photos attached to a pending edit proposal (in-DB bytea). Held here until an
// admin applies the proposal, at which point they become field_photos rows.
// Served (admin-only) via /api/fields/proposal-photo/[id] for the diff view.
// ---------------------------------------------------------------------------

export const fieldEditProposalPhotos = pgTable(
  'field_edit_proposal_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => fieldEditProposals.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('field_edit_proposal_photos_proposal_id_idx').on(table.proposalId)],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const practiceFieldsRelations = relations(practiceFields, ({ many }) => ({
  photos: many(fieldPhotos),
  editProposals: many(fieldEditProposals),
}))

export const fieldEditProposalsRelations = relations(fieldEditProposals, ({ one, many }) => ({
  field: one(practiceFields, { fields: [fieldEditProposals.fieldId], references: [practiceFields.id] }),
  photos: many(fieldEditProposalPhotos),
}))

export const fieldPhotosRelations = relations(fieldPhotos, ({ one }) => ({
  field: one(practiceFields, { fields: [fieldPhotos.fieldId], references: [practiceFields.id] }),
}))

export const fieldEditProposalPhotosRelations = relations(fieldEditProposalPhotos, ({ one }) => ({
  proposal: one(fieldEditProposals, { fields: [fieldEditProposalPhotos.proposalId], references: [fieldEditProposals.id] }),
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
export type FieldEditProposalPhoto = typeof fieldEditProposalPhotos.$inferSelect
export type NewFieldEditProposalPhoto = typeof fieldEditProposalPhotos.$inferInsert
