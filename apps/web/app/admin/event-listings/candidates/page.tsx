import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import {
  EVENT_LISTING_CANDIDATE_STATUSES,
  EVENT_PROGRAMS,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
  eventListingCandidates,
  eventListingCrawlSources,
  eventListings,
} from '@the-tool-pit/db'
import type { EventListingCandidateStatus, ExtractedEventListingFields, RawEventListingMetadata } from '@the-tool-pit/db'
import { ExtractedList, EvidencePanel, StatusTabs } from '../../_listing/candidate-evidence'
import { CandidateEditor } from '../../_listing/candidate-editor'
import { ListingCandidateActions } from '../../_listing/candidate-actions'
import {
  acceptEventCandidate,
  attachEventCandidate,
  markEventCandidateDuplicate,
  reopenEventCandidate,
  suppressEventCandidate,
} from './actions'

/**
 * Off-season event leads a crawler filed. None of them are on the map, and the
 * only way onto it from here is Accept, which creates a pending listing with no
 * pin. Publishing still happens on the listings screen and still needs
 * coordinates, so a crawl cannot put a wrong date in front of a team on its own.
 */

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25
const TAB_LABELS: Record<string, string> = { published: 'accepted', matched: 'attached' }

export default async function EventCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  await assertAdmin()

  const params = await searchParams
  const status = ((EVENT_LISTING_CANDIDATE_STATUSES as readonly string[]).includes(params.status ?? '')
    ? params.status
    : 'pending') as EventListingCandidateStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const db = getDb()

  const where = eq(eventListingCandidates.status, status)
  const [rows, [totals], counts] = await Promise.all([
    db
      .select({
        candidate: eventListingCandidates,
        sourceLabel: eventListingCrawlSources.label,
        sourceKind: eventListingCrawlSources.kind,
        listingId: eventListings.id,
        listingName: eventListings.name,
        listingStatus: eventListings.status,
      })
      .from(eventListingCandidates)
      .leftJoin(eventListingCrawlSources, eq(eventListingCrawlSources.id, eventListingCandidates.sourceId))
      .leftJoin(eventListings, eq(eventListings.id, eventListingCandidates.matchedListingId))
      .where(where)
      // Newest first. There is no classifier score to sort by here: every
      // connector in this vertical is deterministic, so a lead is not more
      // likely to be real than the one under it.
      .orderBy(desc(eventListingCandidates.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(eventListingCandidates).where(where),
    db
      .select({ status: eventListingCandidates.status, count: sql<number>`count(*)::int` })
      .from(eventListingCandidates)
      .groupBy(eventListingCandidates.status),
  ])

  const total = totals?.total ?? 0
  const countMap: Record<string, number> = Object.fromEntries(counts.map((r) => [r.status, r.count]))
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/event-listings" className="text-xs text-muted hover:text-foreground">
            ← Off-season events
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Event candidates</h1>
        </div>
        <p className="text-sm text-muted">
          {total.toLocaleString()} {TAB_LABELS[status] ?? status}
        </p>
      </div>

      <p className="max-w-3xl text-xs text-muted-2">
        Accept writes a pending listing with no pin, so it lands in the same queue a submitted event
        does. TBA leads carry dates and a venue and never carry cost, capacity or registration state.
        Forum leads carry whatever the thread said.
      </p>

      <StatusTabs
        basePath="/admin/event-listings/candidates"
        statuses={EVENT_LISTING_CANDIDATE_STATUSES}
        active={status}
        counts={countMap}
        labels={TAB_LABELS}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing {TAB_LABELS[status] ?? status}.{' '}
          {status === 'pending' && (
            <>
              Sweeps run overnight;{' '}
              <Link href="/admin/event-listings/sources" className="text-primary hover:underline">
                run one now
              </Link>{' '}
              if you would rather not wait.
            </>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ candidate: row, sourceLabel, sourceKind, listingId, listingName, listingStatus }) => {
            const meta = (row.rawMetadata ?? {}) as RawEventListingMetadata
            const ex = (row.extracted ?? {}) as ExtractedEventListingFields
            const title = ex.name || meta.title || row.canonicalUrl || row.sourceUrl
            const dates = ex.startDate ? (ex.endDate && ex.endDate !== ex.startDate ? `${ex.startDate} to ${ex.endDate}` : ex.startDate) : null
            const place = [ex.city, ex.region, ex.country].filter(Boolean).join(', ') || null
            const ev = meta.readEvidence ?? {}
            const cost =
              ex.costUsd !== undefined && ex.costUsd !== null
                ? `$${ex.costUsd}${ex.costNote ? ` (${ex.costNote})` : ''}`
                : (ex.costNote ?? null)

            return (
              <article key={row.id} className="rounded-lg border border-border bg-surface p-4">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                  <p className="text-[10px] text-muted-2">
                    {sourceLabel ?? 'no source row'} · {sourceKind ?? meta.discoveredVia ?? 'unknown kind'} ·{' '}
                    {new Date(row.createdAt).toLocaleDateString()}
                  </p>
                </header>

                {row.rejectionReason && <p className="mt-1 text-xs text-frc">{row.rejectionReason}</p>}

                <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
                  <div className="min-w-0 flex-1">
                    {row.status === 'pending' ? (
                      <CandidateEditor
                        candidateId={row.id}
                        accept={acceptEventCandidate}
                        acceptLabel="Accept and publish"
                        note="Publishes straight away when it has a pin, a date, a venue, an address, a program and a registration state. Anything short of that is saved and the missing field is named."
                        fields={[
                          { name: 'name', label: 'Name', value: ex.name ?? meta.title ?? '', wide: true, evidence: ev.name },
                          { name: 'program', label: 'Program', type: 'select', options: EVENT_PROGRAMS, value: ex.program, evidence: ev.program },
                          { name: 'hostTeamNumber', label: 'Host team', type: 'number', value: ex.hostTeamNumber, evidence: ev.hostTeamNumber },
                          { name: 'startDate', label: 'First day', type: 'date', value: ex.startDate, evidence: ev.startDate },
                          { name: 'endDate', label: 'Last day', type: 'date', value: ex.endDate, evidence: ev.endDate },
                          { name: 'venueName', label: 'Venue', value: ex.venueName, wide: true, evidence: ev.venueName },
                          { name: 'address', label: 'Address', value: ex.address, wide: true, evidence: ev.address },
                          { name: 'city', label: 'City', value: ex.city, evidence: ev.city },
                          { name: 'region', label: 'State', value: ex.region, evidence: ev.region },
                          { name: 'country', label: 'Country', value: ex.country, evidence: ev.country },
                          { name: 'capacity', label: 'Capacity', type: 'number', value: ex.capacity, evidence: ev.capacity },
                          { name: 'costUsd', label: 'Cost (USD)', type: 'number', value: ex.costUsd, evidence: ev.costUsd },
                          { name: 'costNote', label: 'Cost note', value: ex.costNote, evidence: ev.costNote },
                          { name: 'registrationStatus', label: 'Registration', type: 'select', options: REGISTRATION_STATUSES, value: ex.registrationStatus, evidence: ev.registrationStatus },
                          { name: 'volunteerStatus', label: 'Volunteers', type: 'select', options: VOLUNTEER_STATUSES, value: ex.volunteerStatus, evidence: ev.volunteerStatus },
                          { name: 'website', label: 'Website', value: ex.website, wide: true, evidence: ev.website },
                          { name: 'registrationUrl', label: 'Sign-up link', value: ex.registrationUrl, wide: true, evidence: ev.registrationUrl },
                          { name: 'volunteerUrl', label: 'Volunteer link', value: ex.volunteerUrl, wide: true, evidence: ev.volunteerUrl },
                          { name: 'contactEmail', label: 'Contact email', value: ex.contactEmail, wide: true, evidence: ev.contactEmail },
                          { name: 'notes', label: 'Notes', type: 'textarea', value: ex.notes, wide: true, evidence: ev.notes },
                          { name: 'tbaKey', label: 'TBA key', value: ex.tbaKey ?? row.tbaKey, evidence: ev.tbaKey },
                        ]}
                      />
                    ) : (
                      <ExtractedList
                        rows={[
                          ['name', ex.name],
                          ['dates', dates],
                          ['venue', ex.venueName],
                          ['place', place],
                          ['cost', cost],
                          ['registration', ex.registrationStatus],
                        ]}
                        evidence={meta.readEvidence}
                        keys={{ dates: 'startDate', venue: 'venueName', place: 'city', cost: 'costUsd', registration: 'registrationStatus' }}
                      />
                    )}
                  </div>

                  <div className="min-w-0 lg:w-80 lg:shrink-0">
                    <EvidencePanel
                      sourceUrl={row.sourceUrl}
                      canonicalUrl={row.canonicalUrl}
                      description={meta.description}
                      discoveredVia={meta.discoveredVia}
                      evidence={meta.evidence}
                      links={meta.links}
                      readPages={meta.readPages}
                      readRejected={meta.readRejected}
                      readAt={meta.readAt}
                    />
                  </div>
                </div>

                <div className="mt-4 border-t border-border-subtle pt-3">
                  <ListingCandidateActions
                    candidateId={row.id}
                    status={row.status}
                    matchedLabel={
                      listingId ? `listing: ${listingName ?? listingId} (${listingStatus ?? 'unknown'})` : null
                    }
                    refPlaceholder="listing id or TBA key"
                    attach={attachEventCandidate}
                    suppress={suppressEventCandidate}
                    markDuplicate={markEventCandidateDuplicate}
                    reopen={reopenEventCandidate}
                  />
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/event-listings/candidates?status=${status}&page=${n}`} />
    </div>
  )
}
