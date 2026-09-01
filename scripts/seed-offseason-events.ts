/**
 * Seeds the Off-Season Events map from Filip's "2026 FIM Off-Season Events"
 * spreadsheet (the Michigan off-season). 16 events, verbatim from the sheet as
 * of its 8/17 update.
 *
 * Inserted as `status: 'pending'` and `source: 'seed'` so they land in the
 * admin review queue, NOT publicly - Filip publishes each after a look, same as
 * the practice-field seed. Coordinates ARE included here (geocoded from the
 * venue addresses via Nominatim during authoring), so a published event shows on
 * the map straight away; a moderator can still nudge any pin.
 *
 * tbaKey is set for the events that already have a 2026 TBA code (verified
 * against the TBA API): once a listing is linked, the roster connector can pull
 * its team count from TBA. The cancelled and later-season events are not in TBA.
 *
 * Run once, after migrating the DB, from the repo root:
 *   DATABASE_URL=postgres://... bun scripts/seed-offseason-events.ts
 * Idempotent: skips an event if one with the same name already exists.
 */
// Relative import (not the package name): this top-level script has no
// node_modules of its own, so it reaches into the db package source.
import { getDb, eventListings, eq } from '../packages/db/src/index'
import type { NewEventListing } from '../packages/db/src/index'

// Every event is in Michigan, USA, 2026 - factored out to keep the rows short.
const MI = { region: 'MI', country: 'USA' } as const

const SEED: NewEventListing[] = [
  {
    name: 'Tornado Tumble',
    ...MI,
    venueName: 'Taylor Sportplex',
    address: '13333 Telegraph Rd, Taylor, MI 48180',
    city: 'Taylor',
    latitude: 42.2092097,
    longitude: -83.2663822,
    startDate: '2026-06-27',
    endDate: '2026-06-28',
    days: 2,
    capacity: 40,
    registrationStatus: 'not_open',
    volunteerStatus: 'not_open',
    eventStatus: 'cancelled',
    website: 'https://trentonrobotics.com/tornado-tumble/',
    contactEmail: 'thsrobotics@gmail.com',
    notes: 'Also an FTC off-season event, $100 registration for FTC.',
  },
  {
    name: 'Mos Eisley Invitational',
    ...MI,
    venueName: 'Belleville High School',
    address: '501 Columbia Ave, Belleville, MI 48111',
    city: 'Belleville',
    latitude: 42.2003048,
    longitude: -83.4932996,
    startDate: '2026-06-26',
    endDate: '2026-06-27',
    days: 1,
    parallelDivisions: true,
    capacity: 32,
    costUsd: 300,
    costNote: '$450 for both days',
    registrationStatus: 'not_open',
    volunteerStatus: 'not_open',
    eventStatus: 'cancelled',
    website: 'https://www.tigerrobotics.net/off-season-events/2026-mos-eisley',
    contactEmail: 'trboorg@gmail.com',
    tbaKey: '2026mibe',
  },
  {
    name: 'AllStar Alliance Invitational',
    ...MI,
    venueName: 'Kettering University Recreation Center',
    address: '1700 University Ave, Flint, MI 48504',
    city: 'Flint',
    latitude: 43.0140409,
    longitude: -83.714004,
    startDate: '2026-07-18',
    endDate: '2026-07-19',
    days: 2,
    capacity: 48,
    costUsd: 700,
    registrationStatus: 'not_open',
    volunteerStatus: 'not_open',
    eventStatus: 'cancelled',
    // Sheet lists "CD Post" as the event link (a Chief Delphi thread, URL not captured).
    contactEmail: 'roboticscenter@kettering.edu',
    notes: 'Teams may form their own alliance in advance and apply as an alliance, or sign up on an interest form to find others.',
  },
  {
    name: 'Rainbow Rumble',
    ...MI,
    venueName: 'Mason High School',
    address: '1001 S Barnes St, Mason, MI 48854',
    city: 'Mason',
    latitude: 42.5699034,
    longitude: -84.4350147,
    startDate: '2026-07-24',
    endDate: '2026-07-26',
    days: 2,
    capacity: 32,
    costUsd: 400,
    registrationStatus: 'not_open',
    volunteerStatus: 'not_open',
    eventStatus: 'completed',
    website: 'https://rainbowrumble.org/',
    notes: 'Scholarships have been available in the past; info still pending.',
    tbaKey: '2026mirr',
  },
  {
    name: 'FAMNM Wolverine Robotics Competition',
    ...MI,
    venueName: 'Skyline High School',
    address: '2552 N Maple Rd, Ann Arbor, MI 48103',
    city: 'Ann Arbor',
    latitude: 42.3052254,
    longitude: -83.77713,
    startDate: '2026-08-01',
    days: 1,
    capacity: 40,
    costUsd: 250,
    registrationStatus: 'not_open',
    volunteerStatus: 'not_open',
    eventStatus: 'completed',
    website: 'https://famnm.club/offseason/',
    contactEmail: 'famnm.offseason@umich.edu',
    tbaKey: '2026miwrc',
  },
  {
    name: 'MARC',
    ...MI,
    venueName: 'Dundee High School',
    address: '130 Viking Drive, Dundee, MI 48131',
    city: 'Dundee',
    latitude: 41.9628847,
    longitude: -83.6624858,
    startDate: '2026-08-15',
    endDate: '2026-08-16',
    days: 2,
    capacity: 32,
    costUsd: 400,
    registrationStatus: 'not_open',
    volunteerStatus: 'not_open',
    eventStatus: 'completed',
    website: 'https://monroecountymarc.wixsite.com/marc/copy-of-monroe',
    contactEmail: 'MonroeCountyMARC@gmail.com',
    tbaKey: '2026marc',
  },
  {
    name: 'The ONE Offseason Event',
    ...MI,
    venueName: 'GRPS University',
    address: '1400 Fuller Ave NE, Grand Rapids, MI 49505',
    city: 'Grand Rapids',
    latitude: 42.99094,
    longitude: -85.639764,
    startDate: '2026-08-29',
    days: 1,
    capacity: 24,
    costUsd: 200,
    registrationStatus: 'not_open',
    volunteerStatus: 'not_open',
    eventStatus: 'cancelled',
    website: 'https://www.thatoneteam.org/offseason/',
    contactEmail: 'events@thatoneteam.org',
  },
  {
    name: 'Kettering Kickoff',
    ...MI,
    venueName: 'Kettering University Recreation Center',
    address: '1700 University Ave, Flint, MI 48504',
    city: 'Flint',
    latitude: 43.0140409,
    longitude: -83.714004,
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    days: 1,
    parallelDivisions: true,
    capacity: 40,
    costUsd: 300,
    registrationStatus: 'open',
    volunteerStatus: 'open',
    eventStatus: 'confirmed',
    // Sheet lists "CD Post" (a Chief Delphi thread) as the event link.
    contactEmail: 'roboticscenter@kettering.edu',
    // Two-day event; TBA splits it as 2026mifli1 (Day 1) and 2026mifli2 (Day 2).
    tbaKey: '2026mifli1',
  },
  {
    name: 'FSU Roboday',
    ...MI,
    venueName: 'Ferris State University Jim Wink Arena',
    address: '210 Sports Dr, Big Rapids, MI 49307',
    city: 'Big Rapids',
    latitude: 43.6821982,
    longitude: -85.4901697,
    startDate: '2026-09-19',
    days: 1,
    capacity: 24,
    costUsd: 175,
    registrationStatus: 'waitlist',
    volunteerStatus: 'open',
    eventStatus: 'confirmed',
    website: 'https://www.flowcode.com/page/ferrisrobotics',
    contactEmail: 'NathanLeatherman@ferris.edu',
    notes: 'Robot part and supplier gift-card giveaways. Food provided for all students plus two mentors.',
    tbaKey: '2026mibr',
  },
  {
    name: 'Grand Rapids Girls',
    ...MI,
    venueName: 'Allendale High School',
    address: '10760 68th Ave, Allendale, MI 49401',
    city: 'Allendale',
    latitude: 42.9645558,
    longitude: -85.953598,
    startDate: '2026-09-26',
    days: 1,
    costUsd: 300,
    registrationStatus: 'open',
    volunteerStatus: 'open',
    eventStatus: 'confirmed',
    website: 'http://www.girlsrobotics.org/',
    contactEmail: 'GrandRapidsGirlsRobotics@gmail.com',
    notes: 'Capacity not stated on the sheet.',
  },
  {
    name: 'Detroit City Championship',
    ...MI,
    venueName: 'U of D Jesuit High School',
    address: '8400 Cambridge Ave, Detroit, MI 48221',
    city: 'Detroit',
    latitude: 42.4331239,
    longitude: -83.1543377,
    startDate: '2026-10-10',
    days: 1,
    capacity: 32,
    costUsd: 150,
    registrationStatus: 'open',
    volunteerStatus: 'open',
    eventStatus: 'confirmed',
    website: 'https://mez.engin.umich.edu/dcc/',
    contactEmail: 'detroitchampionship@umich.edu',
    notes: 'Only Detroit teams are eligible.',
  },
  {
    name: 'Goonettes Invitational',
    ...MI,
    venueName: 'Woodhaven High School',
    address: '24787 Van Horn Rd, Brownstown Charter Twp, MI 48134',
    city: 'Brownstown Charter Twp',
    latitude: 42.122282,
    longitude: -83.2719673,
    startDate: '2026-10-10',
    endDate: '2026-10-11',
    days: 2,
    capacity: 32,
    costUsd: 350,
    registrationStatus: 'waitlist',
    volunteerStatus: 'open',
    eventStatus: 'confirmed',
    website: 'https://www.goonettesinvitational.org/',
    contactEmail: 'goonettesinvitational@gmail.com',
    tbaKey: '2026mibro1',
  },
  {
    name: 'Bloomfield All-Girls',
    ...MI,
    venueName: 'Bloomfield High School',
    address: '4200 Andover Rd, Bloomfield Twp, MI 48302',
    city: 'Bloomfield Twp',
    latitude: 42.5790011,
    longitude: -83.2870304,
    startDate: '2026-10-17',
    days: 1,
    capacity: 32,
    costUsd: 300,
    registrationStatus: 'not_open',
    registrationOpensAt: '2026-08-01',
    volunteerStatus: 'unknown',
    eventStatus: 'tentative',
    website: 'https://www.team2834.com/events/bgrc',
    contactEmail: 'bloomfieldhillsrobotic@gmail.com',
    notes: 'Scholarships available for rising seniors.',
  },
  {
    name: 'WMRI',
    ...MI,
    venueName: 'Zeeland East High School',
    address: '3333 96th Ave, Zeeland, MI 49464',
    city: 'Zeeland',
    latitude: 42.828698,
    longitude: -86.0211487,
    startDate: '2026-10-24',
    days: 1,
    capacity: 32,
    costUsd: 200,
    registrationStatus: 'waitlist',
    volunteerStatus: 'unknown',
    eventStatus: 'confirmed',
    website: 'https://westmifirst.org/wmri',
    contactEmail: 'usfirst@zps.org',
  },
  {
    name: "C3 (Cullen's Cancer Clash)",
    ...MI,
    venueName: 'Northville High School',
    address: '45700 Six Mile Rd, Northville, MI 48168',
    city: 'Northville',
    latitude: 42.411892,
    longitude: -83.4953825,
    startDate: '2026-10-24',
    endDate: '2026-10-25',
    days: 2,
    capacity: 40,
    costUsd: 400,
    registrationStatus: 'open',
    volunteerStatus: 'open',
    eventStatus: 'confirmed',
    website: 'https://c3robots.org/',
    contactEmail: 'info@c3robots.org',
    notes: '$200 for a second robot. $100 from each registration goes to a YSC charity.',
  },
  {
    name: 'Bot Bash',
    ...MI,
    venueName: 'Herbert Henry Dow High School',
    address: '3901 N Saginaw Rd, Midland, MI 48640',
    city: 'Midland',
    latitude: 43.6381522,
    longitude: -84.2759426,
    startDate: '2026-10-31',
    days: 1,
    capacity: 32,
    costUsd: 300,
    registrationStatus: 'open',
    volunteerStatus: 'open',
    eventStatus: 'confirmed',
    website: 'https://www.first-glbr.org/great-lakes-bay-bot-bash.html',
  },
]

async function main() {
  const db = getDb()
  let inserted = 0
  let skipped = 0
  for (const ev of SEED) {
    const existing = await db
      .select({ id: eventListings.id })
      .from(eventListings)
      .where(eq(eventListings.name, ev.name))
      .limit(1)
    if (existing.length > 0) {
      skipped++
      continue
    }
    await db.insert(eventListings).values({ ...ev, program: 'frc', status: 'pending', source: 'seed' })
    inserted++
    console.log(`  + ${ev.name}`)
  }
  console.log(`Done. ${inserted} inserted, ${skipped} already present. Publish them in /admin/event-listings.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
