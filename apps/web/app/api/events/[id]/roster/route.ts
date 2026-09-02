import { type NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings, eventRosterSnapshots } from '@the-tool-pit/db'
import type { RosterTeam } from '@the-tool-pit/db'

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
  const [snap] = await db
    .select({ teams: eventRosterSnapshots.teams })
    .from(eventRosterSnapshots)
    .innerJoin(eventListings, eq(eventListings.id, eventRosterSnapshots.eventListingId))
    .where(
      and(
        eq(eventRosterSnapshots.eventListingId, id),
        eq(eventRosterSnapshots.status, 'approved'),
        eq(eventListings.status, 'published'),
      ),
    )
    .orderBy(desc(eventRosterSnapshots.fetchedAt))
    .limit(1)

  const teams: RosterTeam[] = snap?.teams ?? []
  return NextResponse.json({ teams })
}
