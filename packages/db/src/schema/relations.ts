/**
 * Cross-schema Drizzle relations.
 * Kept in one file to avoid circular imports between schema modules.
 * These are only needed for Drizzle's `with:` query builder;
 * explicit joins work without them.
 */
import { relations } from 'drizzle-orm'
import { programs } from './programs'
import { audiencePrimaryRoles, audienceFunctions } from './audience'
import {
  tools,
  toolPrograms,
  toolLinks,
  toolAudiencePrimaryRoles,
  toolAudienceFunctions,
} from './tools'
import { toolSources, toolUpdates } from './sources'
import { toolVotes } from './votes'
import { toolClickEvents } from './analytics'
import { submissions } from './submissions'
import { crawlJobs, crawlCandidates } from './crawl'

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------
export const programsRelations = relations(programs, ({ many }) => ({
  toolPrograms: many(toolPrograms),
}))

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------
export const audiencePrimaryRolesRelations = relations(audiencePrimaryRoles, ({ many }) => ({
  toolRoles: many(toolAudiencePrimaryRoles),
}))

export const audienceFunctionsRelations = relations(audienceFunctions, ({ many }) => ({
  toolFunctions: many(toolAudienceFunctions),
}))

// ---------------------------------------------------------------------------
// Tools (extend the relations already defined in tools.ts)
// ---------------------------------------------------------------------------
export const toolsExtendedRelations = relations(tools, ({ many }) => ({
  sources: many(toolSources),
  updates: many(toolUpdates),
  votes: many(toolVotes),
  clickEvents: many(toolClickEvents),
}))

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------
export const submissionsRelations = relations(submissions, ({ one }) => ({
  resolvedTool: one(tools, {
    fields: [submissions.resolvedToolId],
    references: [tools.id],
  }),
}))

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------
export const crawlJobsRelations = relations(crawlJobs, ({ many }) => ({
  candidates: many(crawlCandidates),
}))

export const crawlCandidatesRelations = relations(crawlCandidates, ({ one }) => ({
  job: one(crawlJobs, { fields: [crawlCandidates.jobId], references: [crawlJobs.id] }),
  matchedTool: one(tools, {
    fields: [crawlCandidates.matchedToolId],
    references: [tools.id],
  }),
}))
