import { asc, desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { FIELD_CRAWL_SOURCE_KINDS, practiceFieldCandidates, practiceFieldCrawlSources } from '@the-tool-pit/db'
import { LISTING_CONNECTORS, connectorForSourceKind } from '@/lib/admin/listing-discovery'
import { ListingSourcesScreen } from '../../_listing/sources-screen'
import {
  createFieldSource,
  runFieldConnector,
  runFieldSource,
  setFieldSourceCadence,
  setFieldSourceEnabled,
} from './actions'

export const dynamic = 'force-dynamic'

export default async function FieldSourcesPage() {
  await assertAdmin()
  const db = getDb()

  const [sources, pendingCounts] = await Promise.all([
    db
      .select()
      .from(practiceFieldCrawlSources)
      .orderBy(
        desc(practiceFieldCrawlSources.enabled),
        asc(practiceFieldCrawlSources.kind),
        asc(practiceFieldCrawlSources.label),
      ),
    db
      .select({ sourceId: practiceFieldCandidates.sourceId, count: sql<number>`count(*)::int` })
      .from(practiceFieldCandidates)
      .where(eq(practiceFieldCandidates.status, 'pending'))
      .groupBy(practiceFieldCandidates.sourceId),
  ])

  const pendingBySource = new Map(pendingCounts.filter((c) => c.sourceId).map((c) => [c.sourceId as string, c.count]))

  return (
    <ListingSourcesScreen
      title="Field discovery sources"
      backHref="/admin/practice-fields"
      backLabel="Practice fields"
      intro="There is no structured source for practice fields anywhere, so this is one forum search reading prose. Expect the reject count to run ahead of the yield: a thread asking for a field matches the same words as a thread offering one. Weekly cadence, because a field is offered a handful of times a season."
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
        runnable: connectorForSourceKind('field', s.kind) !== null,
      }))}
      kinds={FIELD_CRAWL_SOURCE_KINDS}
      defaultCadence={168}
      connectors={LISTING_CONNECTORS.field}
      crawlsHref="/admin/crawls?vertical=fields"
      candidatesHref="/admin/practice-fields/candidates"
      run={runFieldSource}
      setEnabled={setFieldSourceEnabled}
      setCadence={setFieldSourceCadence}
      create={createFieldSource}
      runConnector={runFieldConnector}
    />
  )
}
