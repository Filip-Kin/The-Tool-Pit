import { pgTable, text, serial } from 'drizzle-orm/pg-core'

export const programs = pgTable('programs', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(), // 'frc' | 'ftc' | 'fll'
  name: text('name').notNull(),
  description: text('description'),
})

export type Program = typeof programs.$inferSelect
export type NewProgram = typeof programs.$inferInsert
