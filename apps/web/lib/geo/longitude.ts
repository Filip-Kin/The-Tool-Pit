/**
 * Longitude arithmetic for the Leaflet maps.
 *
 * The basemap tiles repeat forever in both directions, so a visitor can pan
 * east or west onto a second, third or tenth copy of the world. Leaflet reports
 * the longitude of the copy that is on screen, not the real one, so a click
 * three worlds east comes back as 540 instead of 180. A marker, on the other
 * hand, is drawn only at its real longitude, so it is invisible from every copy
 * but the first.
 *
 * Both problems are longitude bookkeeping, and both live here. Nothing else in
 * the app should do arithmetic on a longitude by hand.
 */

/** Width of one copy of the world, in degrees. */
const WORLD = 360

/**
 * Fold any longitude back onto the real world, in [-180, 180].
 *
 * This is what a coordinate must go through before it is saved. The field
 * submit and edit handlers, and the event one, all drop a longitude outside
 * that range on the floor, so an unfolded value does not fail loudly: it files
 * the record with no position at all and the pin never appears again.
 */
export function wrapLongitude(lng: number): number {
  if (lng >= -180 && lng <= 180) return lng
  const folded = (((lng + 180) % WORLD) + WORLD) % WORLD - 180
  // 180 and -180 are the same meridian, and the fold always lands on -180.
  // Keep the side the caller came from so a pin dropped east of the dateline
  // does not read back as being west of it.
  return folded === -180 && lng > 0 ? 180 : folded
}

/**
 * Move `lng` onto the copy of the world nearest to `viewLng`, keeping the same
 * real position.
 *
 * Used to re-home a marker after a pan, so a pin whose real longitude sits on
 * the far side of the dateline still draws inside the view the visitor is
 * looking at rather than a world away off the edge.
 */
export function longitudeNearestTo(lng: number, viewLng: number): number {
  return lng + WORLD * Math.round((viewLng - lng) / WORLD)
}
