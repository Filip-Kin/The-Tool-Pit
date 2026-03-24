/**
 * Seed reference data: programs and audience taxonomy.
 * Run with: npx tsx src/seed.ts
 */
import { getDb } from './client'
import { programs, audiencePrimaryRoles, audienceFunctions } from './schema/index'

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
    .values([
      { slug: 'student', label: 'Student' },
      { slug: 'mentor', label: 'Mentor' },
      { slug: 'volunteer', label: 'Volunteer' },
      { slug: 'parent_newcomer', label: 'Parent / Newcomer' },
      { slug: 'organizer_staff', label: 'Organizer / Staff' },
    ])
    .onConflictDoNothing()

  console.log('Seeding audience functions...')
  await db
    .insert(audienceFunctions)
    .values([
      { slug: 'programmer', label: 'Programmer' },
      { slug: 'scouter', label: 'Scouter' },
      { slug: 'strategist', label: 'Strategist' },
      { slug: 'cad', label: 'CAD' },
      { slug: 'mechanical', label: 'Mechanical' },
      { slug: 'electrical', label: 'Electrical' },
      { slug: 'drive_team', label: 'Drive Team' },
      { slug: 'awards', label: 'Awards' },
      { slug: 'outreach', label: 'Outreach' },
      { slug: 'team_management', label: 'Team Management' },
      { slug: 'event_ops', label: 'Event Ops' },
      { slug: 'field_technical', label: 'Field Technical' },
      { slug: 'inspection', label: 'Inspection' },
      { slug: 'judging', label: 'Judging' },
    ])
    .onConflictDoNothing()

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
