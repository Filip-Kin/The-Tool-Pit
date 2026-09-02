/**
 * The bar an off-season event clears before it goes on the public page.
 *
 * Its own module, not app/admin/event-listings/actions.ts, because that is a
 * 'use server' file where every export has to be an async server action. A pure
 * rule cannot live there, and a rule that needs a database and an admin session
 * to exercise does not get tested.
 *
 * The gate used to be coordinates alone. That was enough while every row was
 * hand-entered from a spreadsheet, and it stops being enough the moment the TBA
 * and Chief Delphi connectors start filing candidates: TBA fills the name,
 * dates, venue, address and location and CANNOT fill cost, capacity,
 * registration state or a contact. A scraped candidate is a half-filled row by
 * construction, and this is what stands between it and the public page.
 *
 * MEASURED AGAINST THE EXISTING 16, not invented. Every published event today
 * clears every check below. Cost is deliberately NOT a blocker, because one of
 * those 16 has neither a price nor a note and it is a real, correctly listed
 * event. A gate that would reject rows already on the site is a gate the
 * reviewer learns to route around, and then it protects nothing.
 */
export interface EventPublishFacts {
  latitude: number | null
  longitude: number | null
  startDate: string | Date | null
  venueName: string | null
  address: string | null
  program: string | null
  registrationStatus: string | null
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === ''
}

export function eventPublishBlockers(row: EventPublishFacts): string[] {
  const missing: string[] = []

  if (row.latitude == null || row.longitude == null) {
    missing.push('a pin location, so it can go on the map')
  }
  if (row.startDate == null) missing.push('a start date')
  // Venue and address are one thought to a reader deciding whether they can
  // drive to it, and TBA supplies both, so a scraped candidate has no excuse
  // for either.
  if (blank(row.venueName)) missing.push('a venue name')
  if (blank(row.address)) missing.push('a street address')
  if (blank(row.program)) missing.push('a program')
  // "Open", "closed", "waitlist" or "not open yet" are all fine answers. No
  // answer means a team cannot tell whether there is any point in reading on.
  if (blank(row.registrationStatus)) missing.push('a registration status')

  return missing
}
