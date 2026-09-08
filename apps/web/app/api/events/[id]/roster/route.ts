import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings, getTeamNames } from '@the-tool-pit/db'
import { eventDayLabel, latestApprovedRosters } from '@the-tool-pit/db/roster-days'
import type { RosterTeam } from '@the-tool-pit/db'
import { mergeRosterNames } from '@/lib/listings/roster-names'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * The roster the public dialog draws its team table from.
 *
 * READ ONLY, and gated the same way the rest of the public surface is: the
 * teams come from the LATEST APPROVED snapshot (nothing scraped shows before a
 * moderator has approved it), and only for a PUBLISHED listing, so an
 * unpublished event's roster never leaks through a guessed id. A missing
 * snapshot is a normal, empty answer, not an error - plenty of listings have no
 * team list yet.
 *
 * The dialog is a client component fed a plain PublicEvent by the explorer, so
 * the roster is fetched here on demand rather than shipped inside every event
 * on the map. That keeps the map payload small and only pays for a roster when
 * someone actually opens an event.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const db = getDb()
  const [listing] = await db
    .select({
      status: eventListings.status,
      twoDay: eventListings.parallelDivisions,
      startDate: eventListings.startDate,
      endDate: eventListings.endDate,
    })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)
  if (!listing || listing.status !== 'published') return NextResponse.json({ teams: [] })

  const rosters = await latestApprovedRosters(db, id)
  // Fill the names the scrape did not carry. A roster often reads only numbers
  // (CORI hands back 48, 144, 379 with no names), so the team-name cache turns
  // those back into names at render time. ONE batched query for every number on
  // the card. A name the snapshot already has is kept, because a scraped name is
  // what the event chose to call the team; the cache only fills the gaps, and a
  // team the cache has never seen stays a bare number.
  const numbers = rosters.flatMap((r) => r.teams.map((t) => t.number))
  const cache = numbers.length > 0 ? await getTeamNames(numbers) : null
  const named = (teams: RosterTeam[]) => (cache && teams.length > 0 ? mergeRosterNames(teams, cache) : teams)

  // A two-1-day-events listing answers one list PER DAY (each day is its own
  // tournament), plus `teams` as the union so an older reader still gets a
  // roster. An ordinary listing answers `teams` alone.
  if (listing.twoDay) {
    const days = [1, 2]
      .map((day) => {
        const r = rosters.find((x) => x.day === day)
        return { day, label: eventDayLabel(day, listing.startDate, listing.endDate), teams: named(r?.teams ?? []) }
      })
      .filter((d) => d.teams.length > 0 || rosters.some((x) => x.day != null))
    const seen = new Set<string>()
    const union: RosterTeam[] = []
    for (const d of days) for (const t of d.teams) {
      const k = `${t.number}:${t.robot ?? ''}`
      if (!seen.has(k)) { seen.add(k); union.push(t) }
    }
    // Nothing per day yet but an older whole-event snapshot exists: show that.
    if (days.length === 0) {
      const whole = rosters.find((x) => x.day == null)
      return NextResponse.json({ teams: named(whole?.teams ?? []) })
    }
    return NextResponse.json({ teams: union.sort((a, b) => a.number - b.number), days })
  }

  const whole = rosters.find((x) => x.day == null) ?? rosters[0]
  return NextResponse.json({ teams: named(whole?.teams ?? []) })
}
