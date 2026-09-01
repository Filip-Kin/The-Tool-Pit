import { pgTable, uuid, text, real, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tools } from './tools'
import { users } from './accounts'
import type { FieldProgram } from '../field-enums'
import type { ArtifactKind } from '../robot-code-enums'

// Enum-like value tuples live in ../robot-code-enums (a zero-dependency module)
// so the submit form can import them without pulling in the DB client.
// Re-export here so `@the-tool-pit/db` consumers get them from the barrel.
export { ARTIFACT_KINDS, MIN_SEASON_YEAR, currentSeasonYear, maxSeasonYear } from '../robot-code-enums'
export type { ArtifactKind } from '../robot-code-enums'

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    url: text('url').notNull(),
    submitterNote: text('submitter_note'),
    submitterIpHash: text('submitter_ip_hash'),
    /**
     * pending | processing | published | duplicate | rejected | needs_review
     */
    status: text('status').notNull().default('pending'),
    /** Set when the submission results in a tool record */
    resolvedToolId: uuid('resolved_tool_id').references(() => tools.id, { onDelete: 'set null' }),
    /** JSON log of pipeline stages: what happened at each step */
    pipelineLog: jsonb('pipeline_log').$type<PipelineLogEntry[]>(),
    confidenceScore: real('confidence_score'),
    spamScore: real('spam_score'),

    // #region what the submitter told us
    //
    // The Robot Code / CAD archive is indexed on team number, season and
    // code-vs-CAD. Those three are exactly what a submitter knows for certain
    // and what a classifier gets wrong, and wrong attribution is worse than a
    // missing entry, so the robot-code form captures them and they travel with
    // the submission instead of being inferred later.
    //
    // All four are nullable: the generic tool submit form does not ask for any
    // of them, and a tool that is not a team artifact has no season or team.
    /** FIELD_PROGRAMS ('frc' | 'ftc' | 'fll'). Which program the team competes in. */
    program: text('program').$type<FieldProgram>(),
    /** FIRST team number (1-99999) the code or CAD belongs to. */
    teamNumber: integer('team_number'),
    /** Season the artifact was built for, e.g. 2026. */
    seasonYear: integer('season_year'),
    /** ARTIFACT_KINDS. 'code' sets tools.is_team_code on publish, 'cad' sets is_team_cad. */
    artifactKind: text('artifact_kind').$type<ArtifactKind>(),
    // #endregion

    /**
     * The signed-in user who submitted this, when there was one. Sign-in is
     * OPTIONAL here on purpose: an anonymous submission still goes through, so
     * a mentor without an account is never turned away. Signing in buys
     * attribution and, since approval emails, an answer when it is reviewed.
     * NULL therefore means "nobody to tell", and that is the whole check.
     */
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('submissions_status_idx').on(table.status),
    index('submissions_submitted_by_idx').on(table.submittedByUserId),
    index('submissions_created_at_idx').on(table.createdAt),
  ],
)

export const submissionsRelations = relations(submissions, ({ one }) => ({
  resolvedTool: one(tools, {
    fields: [submissions.resolvedToolId],
    references: [tools.id],
  }),
}))

export type Submission = typeof submissions.$inferSelect
export type NewSubmission = typeof submissions.$inferInsert

export interface PipelineLogEntry {
  stage: string
  status: 'ok' | 'warn' | 'error' | 'skip'
  message?: string
  data?: unknown
  timestamp: string
}
