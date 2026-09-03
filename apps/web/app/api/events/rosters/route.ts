import { type NextRequest, NextResponse } from 'next/server'
import { getPublishedRosterTeams } from '@/lib/queries/event-listings'
import type { SeasonScope } from '@/lib/events/event-display'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Team numbers per published listing, for the map's team-number filter.
 *
 * The explorer fetches this once, the first time a reader filters by team, and
 * caches it for the rest of the visit. Keeping it out of the map payload means
 * the page does not carry thirty numbers per event for the readers who never
 * use the filter.
 *
 * `seasons` matches the /events page: absent for the season we are in,
 * `earlier` for the finished ones, so the answer covers exactly the listings on
 * screen. Same gate as /api/events/[id]/roster, one listing at a time: latest
 * APPROVED snapshot only, published listings only.
 */
export async function GET(req: NextRequest) {
  const scope: SeasonScope = req.nextUrl.searchParams.get('seasons') === 'earlier' ? 'earlier' : 'current'
  const teams = await getPublishedRosterTeams({ scope })
  return NextResponse.json({ teams })
}
