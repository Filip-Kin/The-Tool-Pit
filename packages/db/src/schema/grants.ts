import { pgTable, uuid, text, integer, real, boolean, date, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Enum-like value tuples live in ../grant-enums (a zero-dependency module) so
// client components can import them without pulling in the DB client. Re-export
// here so `@the-tool-pit/db` consumers still get them from the barrel.
export {
  GRANT_PROGRAMS,
  FUNDER_TYPES,
  GRANT_GEO_SCOPES,
  GRANT_DEADLINE_TYPES,
  GRANT_EFFORT_LEVELS,
  GRANT_STATUSES,
  GRANT_SOURCE_KINDS,
  GRANT_CYCLE_STATUSES,
  GRANT_REQUIREMENT_KINDS,
  GRANT_REQUIREMENT_OPERATORS,
  GRANT_MATCH_VERDICTS,
  GRANT_APPLICATION_STATUSES,
  TEAM_ORG_TYPES,
  SCHOOL_TYPES,
  GRANT_FIELD_FILL_KINDS,
  GRANT_CANDIDATE_STATUSES,
  GRANT_TRI_STATES,
  GRANT_APPLY_METHODS,
  GRANT_EVIDENCE_SOURCES,
  GRANT_REJECTION_KINDS,
  GRANT_REJECTION_KIND_LABELS,
  ALERT_CHANNELS,
  ALERT_KINDS,
} from '../grant-enums'
export type {
  GrantProgram,
  FunderType,
  GrantGeoScope,
  GrantDeadlineType,
  GrantEffortLevel,
  GrantStatus,
  GrantSourceKind,
  GrantCycleStatus,
  GrantRequirementKind,
  GrantRequirementOperator,
  GrantMatchVerdict,
  GrantApplicationStatus,
  TeamOrgType,
  SchoolType,
  GrantFieldFillKind,
  GrantCandidateStatus,
  GrantTriState,
  GrantApplyMethod,
  GrantEvidenceSource,
  GrantRejectionKind,
  AlertChannel,
  AlertKind,
} from '../grant-enums'

// ---------------------------------------------------------------------------
// Funders
//
// Separate from grants because one funder (Gene Haas, NASA, a state STEM
// office) runs several distinct programmes, and because a funder name
// appearing on many team sponsor pages is itself the discovery signal that
// finds new grants.
// ---------------------------------------------------------------------------

export const grantFunders = pgTable(
  'grant_funders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** FUNDER_TYPES */
    type: text('type').notNull().default('other'),
    website: text('website'),
    logoUrl: text('logo_url'),
    notes: text('notes'),
    /**
     * How many distinct team sponsor pages we have seen this funder on. Pure
     * discovery signal: a name on 3+ team sites is very likely a real,
     * applicable funding source even if we have not found its grant page yet.
     */
    sponsorMentionCount: integer('sponsor_mention_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grant_funders_slug_idx').on(table.slug),
    index('grant_funders_name_idx').on(table.name),
  ],
)

// ---------------------------------------------------------------------------
// Grants
//
// The listing itself. Dates do NOT live here - they live in grant_cycles, one
// row per year, so an annual grant keeps its history and last year's dates can
// predict this year's opening. `verifiedAt` is a HUMAN confirmation; a crawl
// only ever touches `lastCheckedAt` and `contentHash`. A wrong deadline is
// worse than no deadline, so nothing scraped is published unreviewed.
// ---------------------------------------------------------------------------

export const grants = pgTable(
  'grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    funderId: uuid('funder_id').references(() => grantFunders.id, { onDelete: 'set null' }),

    /** One or two sentences shown on the card. */
    summary: text('summary'),
    /** Longer markdown body for the detail page. */
    description: text('description'),
    /** The page a human should read. */
    infoUrl: text('info_url').notNull(),
    /** Where the application actually happens, if it is a different page. */
    applicationUrl: text('application_url'),
    /**
     * How an application is actually submitted. GRANT_APPLY_METHODS.
     *
     * Not every sponsor has a form. A local foundation that wants a posted
     * letter is a real, winnable grant, and a directory that assumes a form
     * hides it, so the method is stated rather than implied by the presence of
     * an application URL.
     */
    applyMethod: text('apply_method').notNull().default('unknown'),
    /** The address on the funder's page for questions or for an application. */
    contactEmail: text('contact_email'),
    /** Where a posted application goes, when the funder asks for one. */
    mailingAddress: text('mailing_address'),

    /** GRANT_PROGRAMS, e.g. ['frc','ftc'] or ['any']. */
    programs: text('programs').array().notNull().default(['any']),

    // --- Geography. Anything narrower than national MUST carry regions. ---
    /** GRANT_GEO_SCOPES */
    geoScope: text('geo_scope').notNull().default('national'),
    /** ISO-3166-1 alpha-2, e.g. ['US','CA']. */
    countries: text('countries').array().notNull().default(['US']),
    /** State / province codes, e.g. ['MI','OH']. Empty when national. */
    regions: text('regions').array().notNull().default([]),
    /** Free-text for a county or metro that has no code. */
    localityNote: text('locality_note'),

    // --- Money ---
    awardMin: integer('award_min'),
    awardMax: integer('award_max'),
    awardCurrency: text('award_currency').notNull().default('USD'),
    /** e.g. "up to 50% of project cost", "in-kind hardware, not cash". */
    awardNotes: text('award_notes'),
    /** True when a team can apply again in a later cycle. */
    renewable: boolean('renewable'),

    // --- Timing ---
    /** GRANT_DEADLINE_TYPES */
    deadlineType: text('deadline_type').notNull().default('unknown'),
    /** GRANT_EFFORT_LEVELS - rough size of the application. */
    effortLevel: text('effort_level').notNull().default('unknown'),

    // --- Moderation and provenance ---
    /** GRANT_STATUSES. Only 'published' is public. */
    status: text('status').notNull().default('pending'),
    /** GRANT_SOURCE_KINDS - how this listing was first found. */
    source: text('source').notNull().default('seed'),
    rejectionReason: text('rejection_reason'),
    /**
     * When a HUMAN last confirmed the facts on this listing against the
     * funder's own page. Rendered publicly as "verified on <date>" so a team
     * can judge how much to trust it. A crawl never sets this.
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),

    // --- Crawl bookkeeping (see grant_snapshots for the history) ---
    /** Last time any crawler fetched infoUrl, successful or not. */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /**
     * Hash of the boilerplate-stripped main content at the last fetch. Equal
     * hash = nothing changed = no AI extraction spend on this pass.
     */
    contentHash: text('content_hash'),
    /**
     * How often to re-fetch, in hours. Set by the scheduler from how close the
     * next deadline is (near deadline = daily, far = weekly, closed =
     * monthly), so we catch a date change while it still matters.
     */
    checkCadenceHours: integer('check_cadence_hours').notNull().default(168),
    /** Consecutive fetch failures. Non-zero for a while means a dead page. */
    checkFailureCount: integer('check_failure_count').notNull().default(0),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grants_slug_idx').on(table.slug),
    index('grants_status_idx').on(table.status),
    index('grants_funder_idx').on(table.funderId),
    index('grants_geo_scope_idx').on(table.geoScope),
    index('grants_last_checked_idx').on(table.lastCheckedAt),
  ],
)

// ---------------------------------------------------------------------------
// Grant cycles
//
// One row per grant per year. This is what a due date actually is. Keeping
// history means a closed grant is a STATE, not a deletion: last year's
// deadline tells a team roughly when this year's window opens, and the
// crawler knows to start watching again.
// ---------------------------------------------------------------------------

export const grantCycles = pgTable(
  'grant_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    /** Calendar year the cycle closes in. */
    cycleYear: integer('cycle_year').notNull(),
    /** When applications open. Null when the funder does not say. */
    opensAt: date('opens_at'),
    /**
     * The deadline. Timestamptz because "11:59pm ET" and "5pm PT" are real and
     * different; deadlineNote carries the funder's own wording.
     */
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    deadlineNote: text('deadline_note'),
    /** When decisions are announced, if stated. */
    decisionAt: date('decision_at'),
    /** GRANT_CYCLE_STATUSES */
    status: text('status').notNull().default('unknown'),
    /** Cycle-specific award size, when it differs from the grant's usual. */
    amountNote: text('amount_note'),
    /** The exact page these dates came off, for the audit trail. */
    sourceUrl: text('source_url'),
    /** Human confirmation of THESE dates, not of the parent listing. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    /**
     * True when the dates are carried over from a previous year as an
     * expectation rather than published by the funder. Always rendered as
     * "expected" and never used for a deadline reminder.
     */
    isEstimated: boolean('is_estimated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grant_cycles_grant_year_idx').on(table.grantId, table.cycleYear),
    index('grant_cycles_deadline_idx').on(table.deadlineAt),
    index('grant_cycles_status_idx').on(table.status),
  ],
)

// ---------------------------------------------------------------------------
// Requirements
//
// Structured so the matcher is a plain SQL/JS test, not an AI call per team
// per grant. Anything that cannot be tested goes in as kind 'other' with
// isBlocking false: it renders as prose on the listing and never rules a team
// out on its own.
// ---------------------------------------------------------------------------

export const grantRequirements = pgTable(
  'grant_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    /** GRANT_REQUIREMENT_KINDS */
    kind: text('kind').notNull(),
    /** GRANT_REQUIREMENT_OPERATORS */
    operator: text('operator').notNull().default('is'),
    /** Scalar or array, compared against the team profile field for `kind`. */
    value: jsonb('value').$type<string | number | boolean | string[] | number[] | null>(),
    /** The funder's own words, shown on the listing. */
    label: text('label').notNull(),
    /**
     * True = failing this rules the team out. False = worth knowing, but the
     * verdict stays 'likely' rather than 'ineligible'.
     */
    isBlocking: boolean('is_blocking').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grant_requirements_grant_idx').on(table.grantId),
    index('grant_requirements_kind_idx').on(table.kind),
  ],
)

// ---------------------------------------------------------------------------
// Application form field map (autofill)
//
// A server cannot type into a form on someone else's site, so autofill here
// means building a pre-filled URL. Google Forms accept `entry.<id>=value`;
// some portals accept plain query parameters. Everything else is `copy`: we
// render the team's answer next to the question with a copy button.
// ---------------------------------------------------------------------------

export const grantFormFields = pgTable(
  'grant_form_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    /** GRANT_FIELD_FILL_KINDS */
    fillKind: text('fill_kind').notNull().default('copy'),
    /** The parameter name, e.g. `entry.1234567890` or `team_number`. */
    paramName: text('param_name'),
    /**
     * Dotted path into the team profile, e.g. `teamNumber`, `contact.email`,
     * `boilerplate.mission`. Resolved server-side against the signed-in user's
     * own profile only.
     */
    profilePath: text('profile_path').notNull(),
    /** The question as the form asks it. */
    label: text('label'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('grant_form_fields_grant_idx').on(table.grantId)],
)

export const grantFundersRelations = relations(grantFunders, ({ many }) => ({
  grants: many(grants),
}))

export const grantsRelations = relations(grants, ({ one, many }) => ({
  funder: one(grantFunders, { fields: [grants.funderId], references: [grantFunders.id] }),
  cycles: many(grantCycles),
  requirements: many(grantRequirements),
  formFields: many(grantFormFields),
}))

export const grantCyclesRelations = relations(grantCycles, ({ one }) => ({
  grant: one(grants, { fields: [grantCycles.grantId], references: [grants.id] }),
}))

export const grantRequirementsRelations = relations(grantRequirements, ({ one }) => ({
  grant: one(grants, { fields: [grantRequirements.grantId], references: [grants.id] }),
}))

export const grantFormFieldsRelations = relations(grantFormFields, ({ one }) => ({
  grant: one(grants, { fields: [grantFormFields.grantId], references: [grants.id] }),
}))

export type GrantFunder = typeof grantFunders.$inferSelect
export type NewGrantFunder = typeof grantFunders.$inferInsert
export type Grant = typeof grants.$inferSelect
export type NewGrant = typeof grants.$inferInsert
export type GrantCycle = typeof grantCycles.$inferSelect
export type NewGrantCycle = typeof grantCycles.$inferInsert
export type GrantRequirement = typeof grantRequirements.$inferSelect
export type NewGrantRequirement = typeof grantRequirements.$inferInsert
export type GrantFormField = typeof grantFormFields.$inferSelect
export type NewGrantFormField = typeof grantFormFields.$inferInsert
