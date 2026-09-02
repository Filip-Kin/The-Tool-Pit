/**
 * Seed reference data: programs and audience taxonomy.
 * Run with: npx tsx src/seed.ts
 */
import { getDb } from './client'
import {
  programs,
  audiencePrimaryRoles,
  audienceFunctions,
  AUDIENCE_PRIMARY_ROLES,
  AUDIENCE_FUNCTION_TERMS,
} from './schema/index'

async function seed() {
  const db = getDb()

  console.log('Seeding programs...')
  await db
    .insert(programs)
    .values([
      { slug: 'frc', name: 'FRC', description: 'FIRST Robotics Competition' },
      { slug: 'ftc', name: 'FTC', description: 'FIRST Tech Challenge' },
      { slug: 'fll', name: 'FLL', description: 'FIRST LEGO League' },
    ])
    .onConflictDoNothing()

  console.log('Seeding audience primary roles...')
  await db
    .insert(audiencePrimaryRoles)
    .values([...AUDIENCE_PRIMARY_ROLES])
    .onConflictDoNothing()

  console.log('Seeding audience functions...')
  await db
    .insert(audienceFunctions)
    .values([...AUDIENCE_FUNCTION_TERMS])
    .onConflictDoNothing()

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
