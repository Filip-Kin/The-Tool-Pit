import { pgTable, text, serial } from 'drizzle-orm/pg-core'

export const audiencePrimaryRoles = pgTable('audience_primary_roles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
})

export const audienceFunctions = pgTable('audience_functions', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
})

export type AudiencePrimaryRole = typeof audiencePrimaryRoles.$inferSelect
export type AudienceFunction = typeof audienceFunctions.$inferSelect

// The vocabulary itself lives in ../audience-enums, which imports nothing, so a
// client component can read it without pulling the postgres client into the
// browser bundle through this file's drizzle import. Re-exported here because
// every server-side caller already reaches for it through the schema.
export * from '../audience-enums'
