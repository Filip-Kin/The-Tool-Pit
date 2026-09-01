import { asc, desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { EVENT_LISTING_SOURCE_KINDS, eventListingCandidates, eventListingCrawlSources } from '@the-tool-pit/db'
import { LISTING_CONNECTORS, connectorForSourceKind } from '@/lib/admin/listing-discovery'
import { ListingSourcesScreen } from '../../_listing/sources-screen'
import {
  createEventSource,
  runEventConnector,
  runEventSource,
  setEventSourceCadence,
  setEventSourceEnabled,
} from './actions'

export const dynamic = 'force-dynamic'

export default async function EventSourcesPage() {
  await assertAdmin()
  const db = getDb()

  const [sources, pendingCounts] = await Promise.all([
    db
      .select()
      .from(eventListingCrawlSources)
      .orderBy(desc(eventListingCrawlSources.enabled), asc(eventListingCrawlSources.kind), asc(eventListingCrawlSources.label)),
    db
      .select({ sourceId: eventListingCandidates.sourceId, count: sql<number>`count(*)::int` })
      .from(eventListingCandidates)
      .where(eq(eventListingCandidates.status, 'pending'))
      .groupBy(eventListingCandidates.sourceId),
  ])

  const pendingBySource = new Map(pendingCounts.filter((c) => c.sourceId).map((c) => [c.sourceId as string, c.count]))

  return (
    <ListingSourcesScreen
      title="Event discovery sources"
      backHref="/admin/event-listings"
      backLabel="Off-season events"
      intro="TBA lists an event once somebody registered it and carries dates and a venue. Chief Delphi has it months earlier and carries prose. Neither carries cost, capacity or an organiser email, so a high yield here still means a half-filled listing that a person finishes."
      sources={sources.map((s) => ({
        id: s.id,
        label: s.label,
        kind: s.kind,
        target: s.target,
        enabled: s.enabled,
        cadenceHours: s.cadenceHours,
        lastRunAt: s.lastRunAt,
        lastError: s.lastError,
        yieldCount: s.yieldCount,
        rejectCount: s.rejectCount,
        notes: s.notes,
        pendingCandidates: pendingBySource.get(s.id) ?? 0,
        runnable: connectorForSourceKind('event', s.kind) !== null,
      }))}
      kinds={EVENT_LISTING_SOURCE_KINDS}
      defaultCadence={24}
      connectors={LISTING_CONNECTORS.event}
      crawlsHref="/admin/crawls?vertical=events"
      candidatesHref="/admin/event-listings/candidates"
      run={runEventSource}
      setEnabled={setEventSourceEnabled}
      setCadence={setEventSourceCadence}
      create={createEventSource}
      runConnector={runEventConnector}
    />
  )
}
