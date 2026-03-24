import { pgTable, text, serial } from 'drizzle-orm/pg-core'

export const audiencePrimaryRoles = pgTable('audience_primary_roles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
})

// student | mentor | volunteer | parent_newcomer | organizer_staff
export const audienceFunctions = pgTable('audience_functions', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
})

// programmer | scouter | strategist | cad | mechanical | electrical |
// drive_team | awards | outreach | team_management | event_ops |
// field_technical | inspection | judging

export type AudiencePrimaryRole = typeof audiencePrimaryRoles.$inferSelect
export type AudienceFunction = typeof audienceFunctions.$inferSelect
