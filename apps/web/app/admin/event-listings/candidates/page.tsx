import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { formatDate } from '@/lib/format/date'
import {
  EVENT_LISTING_CANDIDATE_STATUSES,
  EVENT_PROGRAMS,
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
  eventListingCandidates,
  eventListingCrawlSources,
  eventListings,
} from '@the-tool-pit/db'
import type { EventListingCandidateStatus, ExtractedEventListingFields, RawEventListingMetadata, RosterTeam } from '@the-tool-pit/db'
import { ExtractedList, EvidencePanel } from '../../_listing/candidate-evidence'
import { CandidateEditor } from '../../_listing/candidate-editor'
import { DuplicateBanner } from '../../_listing/duplicate-banner'
import { ListingCandidateActions } from '../../_listing/candidate-actions'
import {
  acceptEventCandidate,
  attachEventCandidate,
  applyEventCandidateMerge,
  compareEventCandidateToListing,
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
  const today = new Date().toISOString().slice(0, 10)

  const where = eq(eventListingCandidates.status, status)
  const [rows, [totals]] = await Promise.all([
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
      // Upcoming first, soonest to happen at the top, so a reviewer works the
      // events teams can still act on before ones that have already run. The
      // start date lives in the extracted jsonb; past and undated leads sink to
      // the bottom, newest-read among them.
      .orderBy(
        sql`case when coalesce(${eventListingCandidates.extracted} ->> 'startDate', '') >= ${today} then 0 else 1 end`,
        sql`(${eventListingCandidates.extracted} ->> 'startDate') asc nulls last`,
        desc(eventListingCandidates.createdAt),
      )
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(eventListingCandidates).where(where),
  ])

  const total = totals?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Does this lead already exist as a listing?
  //
  // Nothing checked before, so a moderator caught duplicates by recognising the
  // name: Mos Eisley and Wolverine are both already on the site, and the
  // crawler filed them again. Off-season names repeat across states, so this is
  // a PROMPT, not a verdict: it shows the reviewer the listing it resembles and
  // offers Attach, and the reviewer decides.
  //
  // Matched on name similarity, because the exact-key check misses the ones
  // that matter: Mos Eisley's candidate and listing share a name but not a
  // date. Only for the leads actually on this page, and only against listings
  // that are not already what this candidate points at.
  const pendingIds = rows.filter((r) => r.candidate.status === 'pending').map((r) => r.candidate.id)
  const dupeRows = pendingIds.length
    ? await db.execute<{ candidate_id: string; listing_id: string; listing_name: string; listing_status: string; sim: number }>(sql`
        select c.id as candidate_id, l.id as listing_id, l.name as listing_name, l.status as listing_status,
               similarity(coalesce(c.extracted->>'name', c.raw_metadata->>'title', ''), l.name) as sim
        from event_listing_candidates c
        join event_listings l
          on similarity(coalesce(c.extracted->>'name', c.raw_metadata->>'title', ''), l.name) > 0.5
         and l.id is distinct from c.matched_listing_id
        where c.id in (${sql.join(pendingIds.map((id) => sql`${id}`), sql`, `)})
        order by sim desc
      `)
    : []
  const dupeByCandidate = new Map<string, { id: string; name: string; status: string; sim: number }>()
  for (const d of dupeRows) {
    // Best match per candidate only. The query is ordered by similarity, so the
    // first one seen is the closest.
    if (!dupeByCandidate.has(d.candidate_id)) {
      dupeByCandidate.set(d.candidate_id, { id: d.listing_id, name: d.listing_name, status: d.listing_status, sim: d.sim })
    }
  }

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
        Every value here was read off the thread and the event&apos;s own site, and carries the
        sentence it came from. Correct anything wrong in the box next to its quote. Accept publishes
        the event when it has a pin, a date, a venue, an address, a program and a registration
        state; short of that it is saved and the missing field is named.
      </p>

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
                    {formatDate(row.createdAt)}
                  </p>
                </header>

                {row.rejectionReason && <p className="mt-1 text-xs text-frc">{row.rejectionReason}</p>}

                {dupeByCandidate.get(row.id) && (
                  <DuplicateBanner
                    candidateId={row.id}
                    match={dupeByCandidate.get(row.id)!}
                    compare={compareEventCandidateToListing}
                    applyMerge={applyEventCandidateMerge}
                  />
                )}

                <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
                  <div className="min-w-0 flex-1">
                    {row.status === 'pending' ? (
                      <>
                      <CandidateEditor
                        candidateId={row.id}
                        accept={acceptEventCandidate}
                        acceptLabel="Accept and publish"
                        note="Publishes straight away when it has a pin, a date, a venue, an address, a program and a registration state. Anything short of that is saved and the missing field is named."
                        // The pin the reviewer sets here fills the address boxes
                        // and rides along with Accept, so a lead lands on the map
                        // without a second trip through the listings screen.
                        pinMap={{
                          initial:
                            ex.latitude != null && ex.longitude != null
                              ? { lat: ex.latitude, lng: ex.longitude }
                              : null,
                        }}
                        fields={[
                          // Same field set and order as the published-event editor
                          // (event-admin-row), so the two edit forms match.
                          { name: 'name', label: 'Name', value: ex.name ?? meta.title ?? '', wide: true, evidence: ev.name },
                          { name: 'program', label: 'Program', type: 'select', options: EVENT_PROGRAMS, value: ex.program, evidence: ev.program },
                          { name: 'hostTeamNumber', label: 'Host team #', type: 'number', value: ex.hostTeamNumber, evidence: ev.hostTeamNumber },
                          { name: 'startDate', label: 'Start date', type: 'date', value: ex.startDate, evidence: ev.startDate },
                          { name: 'endDate', label: 'End date', type: 'date', value: ex.endDate, evidence: ev.endDate },
                          { name: 'days', label: 'Days', type: 'number', value: ex.days, evidence: ev.days },
                          { name: 'capacity', label: 'Capacity', type: 'number', value: ex.capacity, evidence: ev.capacity },
                          { name: 'costUsd', label: 'Cost (USD)', type: 'number', value: ex.costUsd, evidence: ev.costUsd },
                          { name: 'costNote', label: 'Cost note', value: ex.costNote, evidence: ev.costNote },
                          { name: 'eventStatus', label: 'Event status', type: 'select', options: EVENT_STATUSES },
                          { name: 'registrationStatus', label: 'Registration', type: 'select', options: REGISTRATION_STATUSES, value: ex.registrationStatus, evidence: ev.registrationStatus },
                          { name: 'registrationOpensAt', label: 'Registration opens', type: 'date' },
                          { name: 'volunteerStatus', label: 'Volunteers', type: 'select', options: VOLUNTEER_STATUSES, value: ex.volunteerStatus, evidence: ev.volunteerStatus },
                          { name: 'venueName', label: 'Venue', value: ex.venueName, wide: true, evidence: ev.venueName },
                          { name: 'address', label: 'Address', value: ex.address, wide: true, evidence: ev.address },
                          { name: 'city', label: 'City', value: ex.city, evidence: ev.city },
                          { name: 'region', label: 'Region', value: ex.region, evidence: ev.region },
                          { name: 'country', label: 'Country', value: ex.country, evidence: ev.country },
                          { name: 'website', label: 'Website', value: ex.website, wide: true, evidence: ev.website },
                          { name: 'registrationUrl', label: 'Registration URL', value: ex.registrationUrl, wide: true, evidence: ev.registrationUrl },
                          { name: 'volunteerUrl', label: 'Volunteer URL', value: ex.volunteerUrl, wide: true, evidence: ev.volunteerUrl },
                          { name: 'teamListUrl', label: 'Team list page', value: ex.teamListUrl, wide: true, evidence: ev.teamListUrl },
                          { name: 'chiefDelphiUrl', label: 'Chief Delphi URL', value: ex.chiefDelphiUrl, wide: true, evidence: ev.chiefDelphiUrl },
                          { name: 'contactEmail', label: 'Organiser email', value: ex.contactEmail, wide: true, evidence: ev.contactEmail },
                          { name: 'tbaKey', label: 'TBA key', value: ex.tbaKey ?? row.tbaKey, evidence: ev.tbaKey },
                          { name: 'parallelDivisions', label: 'Two parallel 1-day events', type: 'checkbox' },
                          { name: 'notes', label: 'Notes', type: 'textarea', value: ex.notes, wide: true, evidence: ev.notes },
                        ]}
                      />
                      {Array.isArray(ex.rosterTeams) && ex.rosterTeams.length > 0 && (
                        <CandidateRosterPreview teams={ex.rosterTeams} />
                      )}
                      </>
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

/**
 * Read-only view of the team list scraped for a candidate at read time, so a
 * moderator can sanity-check it before publishing. Numbers only, with a B/C robot
 * suffix and the waitlist called out; names resolve from TBA once published.
 */
function CandidateRosterPreview({ teams }: { teams: RosterTeam[] }) {
  const registered = teams.filter((t) => !t.waitlisted)
  const waitlist = teams.filter((t) => t.waitlisted)
  return (
    <div className="mt-3 rounded-lg border border-border-subtle p-3 text-sm">
      <div className="font-medium text-foreground">
        Scraped team list — {registered.length} team{registered.length === 1 ? '' : 's'}
        {waitlist.length > 0 ? ` + ${waitlist.length} waitlist` : ''}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums text-muted">
        {registered.map((t) => (
          <span key={`r-${t.number}-${t.robot ?? ''}`}>
            {t.number}
            {t.robot}
          </span>
        ))}
      </div>
      {waitlist.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums text-reg-waitlist">
          {waitlist.map((t) => (
            <span key={`w-${t.number}-${t.robot ?? ''}`}>
              {t.number}
              {t.robot}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
