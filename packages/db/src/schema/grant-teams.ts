import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './accounts'
import { grants, grantCycles } from './grants'

// ---------------------------------------------------------------------------
// Team profiles
//
// The answers a team gives once and then reuses: what kind of entity it is,
// where it is, who to contact, and the boilerplate paragraphs every
// application asks for. Two jobs:
//
//   1. MATCHING  - every grant_requirements row is tested against a field
//                  here, so eligibility is a deterministic check, not an AI
//                  call per team per grant.
//   2. AUTOFILL  - grant_form_fields.profilePath points at a field here to
//                  build a pre-filled application URL.
//
// Contact details and the EIN are private to the team's own members. Nothing
// in this table is ever exposed on a public page.
// ---------------------------------------------------------------------------

export const teamProfiles = pgTable(
  'team_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** frc | ftc | fll */
    program: text('program').notNull().default('frc'),
    teamNumber: integer('team_number').notNull(),
    teamName: text('team_name'),

    // --- Legal entity. Most grants gate on this before anything else. ---
    /** TEAM_ORG_TYPES */
    orgType: text('org_type').notNull().default('unknown'),
    /** US employer identification number. Private. */
    ein: text('ein'),
    /** Name of the 501(c)(3) applying on the team's behalf, if any. */
    fiscalSponsorName: text('fiscal_sponsor_name'),
    /** SCHOOL_TYPES */
    schoolType: text('school_type').notNull().default('unknown'),
    schoolName: text('school_name'),
    /** Title I designation. A hard gate on several equity-focused grants. */
    titleOne: boolean('title_one'),

    // --- Place ---
    country: text('country').notNull().default('US'),
    /** State / province code. */
    region: text('region'),
    city: text('city'),
    postalCode: text('postal_code'),
    mailingAddress: text('mailing_address'),

    // --- Size and history ---
    rookieYear: integer('rookie_year'),
    studentCount: integer('student_count'),
    mentorCount: integer('mentor_count'),
    annualBudget: integer('annual_budget'),
    /**
     * Self-reported demographic percentages, e.g. { femalePct, frplPct }.
     * Optional, and only ever used to widen the match set, never to narrow it.
     */
    demographics: jsonb('demographics').$type<Record<string, number>>(),

    // --- Contact (private) ---
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    website: text('website'),

    // --- Reusable prose ---
    missionStatement: text('mission_statement'),
    /**
     * Keyed reusable answers, e.g. { outreach: "…", impact: "…" }. The keys are
     * the team's own; grant_form_fields.profilePath addresses them as
     * `boilerplate.<key>`.
     */
    boilerplate: jsonb('boilerplate').$type<Record<string, string>>(),

    /** 0-100, how much of the profile is filled in. Drives the nag on the UI. */
    completeness: integer('completeness').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('team_profiles_program_team_idx').on(table.program, table.teamNumber),
    index('team_profiles_region_idx').on(table.country, table.region),
  ],
)

/**
 * Who may read and edit a team profile. Separate from user_teams (which is a
 * loose "I follow this team") because editing an EIN and a mailing address is
 * a real permission.
 */
export const teamProfileMembers = pgTable(
  'team_profile_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => teamProfiles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** owner | editor | viewer */
    role: text('role').notNull().default('editor'),
    invitedBy: uuid('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('team_profile_members_profile_user_idx').on(table.profileId, table.userId),
    index('team_profile_members_user_idx').on(table.userId),
  ],
)

// ---------------------------------------------------------------------------
// Matches
//
// Recomputed by a nightly job over (published grant x open cycle x profile).
// `missing_info` is kept as a first-class verdict: a team with an unfilled
// profile should be told what to add, not silently shown fewer grants.
// ---------------------------------------------------------------------------

export const grantMatches = pgTable(
  'grant_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => teamProfiles.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').references(() => grantCycles.id, { onDelete: 'set null' }),
    /** GRANT_MATCH_VERDICTS */
    verdict: text('verdict').notNull(),
    /** Ranking within a verdict: award size, effort, days left. */
    score: real('score').notNull().default(0),
    /** Per-requirement outcomes, so the UI can say WHY. */
    reasons: jsonb('reasons').$type<MatchReason[]>(),
    /** Requirement kinds we could not test because the profile lacks the field. */
    missingFields: text('missing_fields').array().notNull().default([]),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set once an alert for this match has gone out, so it only fires once. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    /** Team dismissed it - never resurface. */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('grant_matches_profile_grant_cycle_idx').on(table.profileId, table.grantId, table.cycleId),
    index('grant_matches_profile_verdict_idx').on(table.profileId, table.verdict),
    index('grant_matches_notified_idx').on(table.notifiedAt),
  ],
)

// ---------------------------------------------------------------------------
// Watches - a user subscribing to ONE grant by hand, independent of matching.
// ---------------------------------------------------------------------------

export const grantWatches = pgTable(
  'grant_watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    /** Days before the deadline to remind, e.g. [30, 14, 3]. */
    remindDaysBefore: integer('remind_days_before').array().notNull().default([30, 14, 3]),
    /** Also ping when the listing itself changes (amount, eligibility). */
    notifyOnChange: boolean('notify_on_change').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grant_watches_user_grant_idx').on(table.userId, table.grantId),
    index('grant_watches_grant_idx').on(table.grantId),
  ],
)

// ---------------------------------------------------------------------------
// Applications - a team tracking its own progress. Private to the team.
// ---------------------------------------------------------------------------

export const grantApplications = pgTable(
  'grant_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => teamProfiles.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').references(() => grantCycles.id, { onDelete: 'set null' }),
    /** GRANT_APPLICATION_STATUSES */
    status: text('status').notNull().default('interested'),
    amountRequested: integer('amount_requested'),
    amountAwarded: integer('amount_awarded'),
    notes: text('notes'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    updatedByUserId: uuid('updated_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grant_applications_profile_grant_cycle_idx').on(table.profileId, table.grantId, table.cycleId),
    index('grant_applications_status_idx').on(table.status),
  ],
)

// ---------------------------------------------------------------------------
// Alert outbox
//
// Rows are written by the matcher and the deadline sweeper, then drained by a
// sender. Keeping it as a table rather than firing straight into email means a
// send can be retried, deduped and audited, and a broken provider does not
// lose the alert.
// ---------------------------------------------------------------------------

export const grantAlerts = pgTable(
  'grant_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ALERT_KINDS */
    kind: text('kind').notNull(),
    /** ALERT_CHANNELS */
    channel: text('channel').notNull(),
    grantId: uuid('grant_id').references(() => grants.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').references(() => grantCycles.id, { onDelete: 'set null' }),
    /** Rendered subject/body/url, so a resend is byte-identical. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    /**
     * Idempotency key, e.g. `deadline:<cycleId>:<userId>:14`. Unique, so the
     * same reminder cannot be queued twice by two passes on the same day.
     */
    dedupeKey: text('dedupe_key').notNull(),
    sendAfter: timestamp('send_after', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grant_alerts_dedupe_idx').on(table.dedupeKey),
    index('grant_alerts_pending_idx').on(table.sentAt, table.sendAfter),
    index('grant_alerts_user_idx').on(table.userId),
  ],
)

export const teamProfilesRelations = relations(teamProfiles, ({ many }) => ({
  members: many(teamProfileMembers),
  matches: many(grantMatches),
  applications: many(grantApplications),
}))

export const teamProfileMembersRelations = relations(teamProfileMembers, ({ one }) => ({
  profile: one(teamProfiles, { fields: [teamProfileMembers.profileId], references: [teamProfiles.id] }),
  user: one(users, { fields: [teamProfileMembers.userId], references: [users.id] }),
}))

export const grantMatchesRelations = relations(grantMatches, ({ one }) => ({
  profile: one(teamProfiles, { fields: [grantMatches.profileId], references: [teamProfiles.id] }),
  grant: one(grants, { fields: [grantMatches.grantId], references: [grants.id] }),
  cycle: one(grantCycles, { fields: [grantMatches.cycleId], references: [grantCycles.id] }),
}))

export const grantWatchesRelations = relations(grantWatches, ({ one }) => ({
  user: one(users, { fields: [grantWatches.userId], references: [users.id] }),
  grant: one(grants, { fields: [grantWatches.grantId], references: [grants.id] }),
}))

export const grantApplicationsRelations = relations(grantApplications, ({ one }) => ({
  profile: one(teamProfiles, { fields: [grantApplications.profileId], references: [teamProfiles.id] }),
  grant: one(grants, { fields: [grantApplications.grantId], references: [grants.id] }),
  cycle: one(grantCycles, { fields: [grantApplications.cycleId], references: [grantCycles.id] }),
}))

export const grantAlertsRelations = relations(grantAlerts, ({ one }) => ({
  user: one(users, { fields: [grantAlerts.userId], references: [users.id] }),
  grant: one(grants, { fields: [grantAlerts.grantId], references: [grants.id] }),
}))

export type TeamProfile = typeof teamProfiles.$inferSelect
export type NewTeamProfile = typeof teamProfiles.$inferInsert
export type TeamProfileMember = typeof teamProfileMembers.$inferSelect
export type NewTeamProfileMember = typeof teamProfileMembers.$inferInsert
export type GrantMatch = typeof grantMatches.$inferSelect
export type NewGrantMatch = typeof grantMatches.$inferInsert
export type GrantWatch = typeof grantWatches.$inferSelect
export type NewGrantWatch = typeof grantWatches.$inferInsert
export type GrantApplication = typeof grantApplications.$inferSelect
export type NewGrantApplication = typeof grantApplications.$inferInsert
export type GrantAlert = typeof grantAlerts.$inferSelect
export type NewGrantAlert = typeof grantAlerts.$inferInsert

/** One requirement's outcome, kept on the match so the UI can explain itself. */
export interface MatchReason {
  requirementId: string
  kind: string
  label: string
  /** pass | fail | unknown - `unknown` means the profile lacks the field. */
  outcome: 'pass' | 'fail' | 'unknown'
  isBlocking: boolean
}
