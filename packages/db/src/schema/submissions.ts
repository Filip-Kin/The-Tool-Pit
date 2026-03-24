import { pgTable, uuid, text, real, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tools } from './tools'

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('submissions_status_idx').on(table.status),
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
