/**
 * Seeds the Practice Field Map with the SE Michigan fields shared in the
 * Chief Delphi thread "SE Michigan FRC Community: Help us identify available
 * practice fields".
 *
 * These are inserted as `status: 'pending'` and `source: 'seed'` so they show
 * up in the admin review queue, NOT publicly. They deliberately carry NO
 * coordinates - place each pin during review before publishing. Only facts
 * actually stated in the thread are recorded; anything unconfirmed is left at
 * the column default and called out in the notes so a moderator verifies it.
 *
 * Run once (after migrating the DB), from the repo root:
 *   DATABASE_URL=postgres://... bun scripts/seed-practice-fields.ts
 * Idempotent: skips a field if one with the same team number already exists.
 *
 * Note on team 5090: in the thread, the mentor of 5090 is describing team
 * 2620's field, not a separate one, so it is folded into the 2620 entry.
 */
// Relative import (not the package name): this top-level script has no
// node_modules of its own, so it reaches into the db package source, which
// resolves drizzle-orm/postgres from packages/db/node_modules.
import { getDb, practiceFields, eq } from '../packages/db/src/index'
import type { NewPracticeField } from '../packages/db/src/index'

const SEED: NewPracticeField[] = [
  {
    teamNumber: 1188,
    teamName: 'Royal Oak Robotics',
    name: 'Royal Oak Robotics practice field',
    region: 'MI',
    country: 'USA',
    city: 'Royal Oak',
    coverage: 'full',
    ceilingHeightFt: 10,
    availability: 'year_round',
    notes:
      'Full field at the team facility in downtown Royal Oak, accessible year round. Ceiling is 10 ft, which can be an annoyance for some games. Perimeter/element details unconfirmed - verify before publishing.',
    status: 'pending',
    source: 'seed',
  },
  {
    teamNumber: 5577,
    teamName: 'Motor City Alliance (Team 5577)',
    name: 'Motor City Alliance field at University of Detroit Mercy',
    address: 'University of Detroit Mercy',
    region: 'MI',
    country: 'USA',
    coverage: 'full',
    perimeter: 'wood',
    aprilTags: true,
    availability: 'in_season',
    notes:
      'Full-size wood-construction field set up for the past 2 seasons at University of Detroit Mercy, with a blend of practice and test elements and AprilTags set up for autos. Available in season only. Confirm element type (wood vs official) before publishing.',
    status: 'pending',
    source: 'seed',
  },
  {
    teamNumber: 2620,
    teamName: 'Southgate Titans',
    name: 'Southgate Titans practice field',
    region: 'MI',
    country: 'USA',
    city: 'Southgate',
    coverage: 'full',
    elements: 'wood',
    availability: 'by_arrangement',
    notes:
      'Full field with wood elements. The team is generous about letting other teams come over. (Reported by an 5090 mentor in the thread.) Perimeter details unconfirmed.',
    status: 'pending',
    source: 'seed',
  },
  {
    teamNumber: 2832,
    teamName: 'Team 2832',
    name: 'Team 2832 practice field',
    region: 'MI',
    country: 'USA',
    availability: 'by_arrangement',
    notes:
      'Field at the team center near Churchill, open with prior contact with the team. Reported second-hand ("open last time I was on the team"); location, coverage and element details all unconfirmed - verify before publishing.',
    status: 'pending',
    source: 'seed',
  },
]

async function main() {
  const db = getDb()
  for (const field of SEED) {
    if (field.teamNumber != null) {
      const existing = await db
        .select({ id: practiceFields.id })
        .from(practiceFields)
        .where(eq(practiceFields.teamNumber, field.teamNumber))
        .limit(1)
      if (existing.length) {
        console.log(`skip: team ${field.teamNumber} already has a field`)
        continue
      }
    }
    const [row] = await db.insert(practiceFields).values(field).returning({ id: practiceFields.id })
    console.log(`inserted pending field for team ${field.teamNumber}: ${row.id}`)
  }
  console.log('done - review + place pins in /admin/practice-fields?status=pending')
  process.exit(0)
}

void main()
