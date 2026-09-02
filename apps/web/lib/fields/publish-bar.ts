/**
 * The bar a practice field clears before it goes on the public map.
 *
 * Its own module because app/admin/practice-fields/actions.ts is a 'use
 * server' file, where every export has to be an async server action. A pure
 * rule cannot live there, and a rule that cannot be tested without a database
 * and an admin session does not get tested.
 *
 * The gate used to be coordinates and nothing else, and two published fields
 * carry no contact route at all: a team can see the pin and has no way to ask
 * whether they can use it. A pin nobody can act on is not a listing.
 *
 * TWO HARD BLOCKS, and only two. Coordinates, because the map cannot place the
 * row without them. A contact route, because the whole point is getting hold of
 * whoever runs the field, and any one of an email, a booking link or a website
 * does that.
 *
 * Everything else stays a judgement call for the reviewer. Availability and
 * hours are often genuinely unknown when a field is first listed, and blocking
 * on them would hold back a real field with a real contact who can answer the
 * question directly. A gate that refuses rows the existing catalogue would
 * itself fail is a gate moderators learn to work around.
 */
export function fieldPublishBlockers(row: {
  latitude: number | null
  longitude: number | null
  contactInfo: string | null
  contactUrl: string | null
  website: string | null
}): string[] {
  const missing: string[] = []
  if (row.latitude == null || row.longitude == null) {
    missing.push('a pin location, so it can go on the map')
  }
  const contactable = [row.contactInfo, row.contactUrl, row.website].some(
    (v) => typeof v === 'string' && v.trim() !== '',
  )
  if (!contactable) missing.push('a contact route: an email, a booking link or a website')
  return missing
}
