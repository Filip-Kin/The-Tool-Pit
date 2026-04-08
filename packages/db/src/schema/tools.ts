import {
  pgTable,
  uuid,
  text,
  boolean,
  real,
  timestamp,
  integer,
  index,
  primaryKey,
  foreignKey,
  serial,
} from 'drizzle-orm/pg-core'
import { sql, relations } from 'drizzle-orm'
import { programs } from './programs'
import { audiencePrimaryRoles, audienceFunctions } from './audience'

// ---------------------------------------------------------------------------
// Core tool record
// ---------------------------------------------------------------------------

export const tools = pgTable(
  'tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    summary: text('summary'),          // short (~1-2 sentence) description
    description: text('description'), // longer markdown description

    /**
     * Tool type determines content-type ranking weight.
     * web_app | desktop_app | mobile_app | calculator | spreadsheet |
     * github_project | browser_extension | api | resource | other
     */
    toolType: text('tool_type').notNull().default('other'),

    /**
     * Lifecycle status:
     * draft — ingested, below confidence threshold
     * published — visible to public
     * suppressed — hidden (spam, dupe, removed)
     */
    status: text('status').notNull().default('draft'),

    isOfficial: boolean('is_official').notNull().default(false),
    isVendor: boolean('is_vendor').notNull().default(false),
    isRookieFriendly: boolean('is_rookie_friendly').notNull().default(false),
    /**
     * True if this is a specific team's own robot code repository rather than
     * a general-purpose tool or library used by many teams.
     */
    isTeamCode: boolean('is_team_code').notNull().default(false),
    /** FIRST team number (1–99999), e.g. 254, 1114. Nullable. */
    teamNumber: integer('team_number'),
    /** Season year the code was written for, e.g. 2024. Nullable. */
    seasonYear: integer('season_year'),
    vendorName: text('vendor_name'),

    /**
     * Scores computed by the ranking pipeline.
     * popularityScore is denormalized from vote count + click events.
     */
    confidenceScore: real('confidence_score').default(0),
    popularityScore: real('popularity_score').notNull().default(0),

    /**
     * Internal freshness state (collapsed to Current/Stale/Abandoned for UI).
     * active | stale | inactive | evergreen | seasonal | archived | unknown
     */
    freshnessState: text('freshness_state').default('unknown'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Postgres full-text search index (GIN)
    index('tools_search_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.name} || ' ' || coalesce(${table.summary}, '') || ' ' || coalesce(${table.description}, ''))`,
    ),
    // Trigram index for fuzzy / prefix search (requires pg_trgm extension)
    index('tools_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    index('tools_status_idx').on(table.status),
    index('tools_popularity_idx').on(table.popularityScore),
    index('tools_published_at_idx').on(table.publishedAt),
    index('tools_is_team_code_idx').on(table.isTeamCode),
    index('tools_team_number_idx').on(table.teamNumber),
    index('tools_season_year_idx').on(table.seasonYear),
  ],
)

// ---------------------------------------------------------------------------
// Many-to-many: tools ↔ programs
// ---------------------------------------------------------------------------

export const toolPrograms = pgTable(
  'tool_programs',
  {
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    programId: integer('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.toolId, table.programId] })],
)

// ---------------------------------------------------------------------------
// Many-to-many: tools ↔ audience
// ---------------------------------------------------------------------------

export const toolAudiencePrimaryRoles = pgTable(
  'tool_audience_primary_roles',
  {
    // No .references() here — FK is defined at table level with a short name
    // to stay under Postgres's 63-character identifier limit
    toolId: uuid('tool_id').notNull(),
    roleId: integer('role_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.toolId, table.roleId] }),
    foreignKey({ columns: [table.toolId], foreignColumns: [tools.id], name: 'tapr_tool_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.roleId], foreignColumns: [audiencePrimaryRoles.id], name: 'tapr_role_fk' }).onDelete('cascade'),
  ],
)

export const toolAudienceFunctions = pgTable(
  'tool_audience_functions',
  {
    toolId: uuid('tool_id').notNull(),
    functionId: integer('function_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.toolId, table.functionId] }),
    foreignKey({ columns: [table.toolId], foreignColumns: [tools.id], name: 'taf_tool_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.functionId], foreignColumns: [audienceFunctions.id], name: 'taf_fn_fk' }).onDelete('cascade'),
  ],
)

// ---------------------------------------------------------------------------
// Links (homepage, docs, github, issues, changelog, etc.)
// ---------------------------------------------------------------------------

export const toolLinks = pgTable(
  'tool_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    /**
     * homepage | docs | github | issues | changelog | source | video | other
     */
    linkType: text('link_type').notNull(),
    url: text('url').notNull(),
    label: text('label'),
    isBroken: boolean('is_broken').notNull().default(false),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tool_links_tool_id_idx').on(table.toolId),
    index('tool_links_type_idx').on(table.linkType),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const toolsRelations = relations(tools, ({ many }) => ({
  toolPrograms: many(toolPrograms),
  toolAudiencePrimaryRoles: many(toolAudiencePrimaryRoles),
  toolAudienceFunctions: many(toolAudienceFunctions),
  toolLinks: many(toolLinks),
}))

export const toolProgramsRelations = relations(toolPrograms, ({ one }) => ({
  tool: one(tools, { fields: [toolPrograms.toolId], references: [tools.id] }),
  program: one(programs, { fields: [toolPrograms.programId], references: [programs.id] }),
}))

export const toolAudiencePrimaryRolesRelations = relations(toolAudiencePrimaryRoles, ({ one }) => ({
  tool: one(tools, { fields: [toolAudiencePrimaryRoles.toolId], references: [tools.id] }),
  role: one(audiencePrimaryRoles, {
    fields: [toolAudiencePrimaryRoles.roleId],
    references: [audiencePrimaryRoles.id],
  }),
}))

export const toolAudienceFunctionsRelations = relations(toolAudienceFunctions, ({ one }) => ({
  tool: one(tools, { fields: [toolAudienceFunctions.toolId], references: [tools.id] }),
  function: one(audienceFunctions, {
    fields: [toolAudienceFunctions.functionId],
    references: [audienceFunctions.id],
  }),
}))

export const toolLinksRelations = relations(toolLinks, ({ one }) => ({
  tool: one(tools, { fields: [toolLinks.toolId], references: [tools.id] }),
}))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tool = typeof tools.$inferSelect
export type NewTool = typeof tools.$inferInsert
export type ToolLink = typeof toolLinks.$inferSelect
export type NewToolLink = typeof toolLinks.$inferInsert

export const TOOL_TYPES = [
  'web_app',
  'desktop_app',
  'mobile_app',
  'calculator',
  'spreadsheet',
  'github_project',
  'browser_extension',
  'api',
  'resource',
  'other',
] as const
export type ToolType = (typeof TOOL_TYPES)[number]

export const TOOL_STATUSES = ['draft', 'published', 'suppressed'] as const
export type ToolStatus = (typeof TOOL_STATUSES)[number]

export const FRESHNESS_STATES = [
  'active',
  'stale',
  'inactive',
  'evergreen',
  'seasonal',
  'archived',
  'unknown',
] as const
export type FreshnessState = (typeof FRESHNESS_STATES)[number]

/** Maps internal freshness state to user-facing label. Never shows "Unknown". */
export function toPublicFreshnessLabel(state: FreshnessState | null | undefined): 'Current' | 'Stale' | 'Abandoned' | null {
  switch (state) {
    case 'active':
    case 'evergreen':
    case 'seasonal':
      return 'Current'
    case 'stale':
      return 'Stale'
    case 'inactive':
    case 'archived':
      return 'Abandoned'
    case 'unknown':
    default:
      return null // don't show anything if we genuinely don't know
  }
}

/** Content-type ranking weight (0–1). */
export const TOOL_TYPE_WEIGHTS: Record<ToolType, number> = {
  web_app: 1.0,
  calculator: 1.0,
  desktop_app: 0.9,
  github_project: 0.85,
  browser_extension: 0.8,
  mobile_app: 0.8,
  api: 0.7,
  spreadsheet: 0.4,
  resource: 0.35,
  other: 0.5,
}
