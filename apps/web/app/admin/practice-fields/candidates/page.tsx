import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import {
  FIELD_CANDIDATE_STATUSES,
  FIELD_PROGRAMS,
  FIELD_COVERAGE,
  FIELD_PERIMETER,
  FIELD_ELEMENTS,
  FIELD_AVAILABILITY,
  practiceFieldCandidates,
  practiceFieldCrawlSources,
  practiceFields,
} from '@the-tool-pit/db'
import type { FieldCandidateStatus, ExtractedPracticeFieldFields, RawPracticeFieldMetadata } from '@the-tool-pit/db'
import { ExtractedList, EvidencePanel } from '../../_listing/candidate-evidence'
import { CandidateEditor } from '../../_listing/candidate-editor'
import { ListingCandidateActions } from '../../_listing/candidate-actions'
import {
  acceptFieldCandidate,
  attachFieldCandidate,
  markFieldCandidateDuplicate,
  reopenFieldCandidate,
  suppressFieldCandidate,
} from './actions'

/**
 * Practice-field leads a crawler filed.
 *
 * Expect to suppress most of them. The forum connector matches threads that
 * talk about practice fields, and a thread asking "does anyone within two
 * hours of Grand Rapids have a field" reads to a keyword match exactly like a
 * team offering one. That is why the quoted post is on the card: the decision
 * is a five-second read of the words, not a guess from the title.
 */

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25
const TAB_LABELS: Record<string, string> = { published: 'accepted', matched: 'attached' }

export default async function FieldCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  await assertAdmin()

  const params = await searchParams
  const status = ((FIELD_CANDIDATE_STATUSES as readonly string[]).includes(params.status ?? '')
    ? params.status
    : 'pending') as FieldCandidateStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const db = getDb()

  const where = eq(practiceFieldCandidates.status, status)
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        candidate: practiceFieldCandidates,
        sourceLabel: practiceFieldCrawlSources.label,
        sourceKind: practiceFieldCrawlSources.kind,
        fieldId: practiceFields.id,
        fieldName: practiceFields.name,
        fieldStatus: practiceFields.status,
      })
      .from(practiceFieldCandidates)
      .leftJoin(practiceFieldCrawlSources, eq(practiceFieldCrawlSources.id, practiceFieldCandidates.sourceId))
      .leftJoin(practiceFields, eq(practiceFields.id, practiceFieldCandidates.matchedFieldId))
      .where(where)
      .orderBy(desc(practiceFieldCandidates.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(practiceFieldCandidates).where(where),
  ])

  const total = totals?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/practice-fields" className="text-xs text-muted hover:text-foreground">
            ← Practice fields
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Field candidates</h1>
        </div>
        <p className="text-sm text-muted">
          {total.toLocaleString()} {TAB_LABELS[status] ?? status}
        </p>
      </div>

      <p className="max-w-3xl text-xs text-muted-2">
        Read the quoted post before you accept. A thread that mentions a practice field is as likely
        to be someone looking for one as someone offering one. Every value below carries the
        sentence it came from, so check the words rather than the label, and correct anything wrong
        in the box beside its quote. Accept publishes when the field has a pin and a way to get in
        touch; coordinates are never guessed, so the pin is usually yours to place.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing {TAB_LABELS[status] ?? status}.{' '}
          {status === 'pending' && (
            <>
              The forum sweep runs weekly;{' '}
              <Link href="/admin/practice-fields/sources" className="text-primary hover:underline">
                run one now
              </Link>{' '}
              if you would rather not wait.
            </>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(({ candidate: row, sourceLabel, sourceKind, fieldId, fieldName, fieldStatus }) => {
            const meta = (row.rawMetadata ?? {}) as RawPracticeFieldMetadata
            const ex = (row.extracted ?? {}) as ExtractedPracticeFieldFields
            const title = ex.name || meta.title || row.canonicalUrl || row.sourceUrl
            const place = [ex.city, ex.region, ex.country].filter(Boolean).join(', ') || null
            const ev = meta.readEvidence ?? {}

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
                        accept={acceptFieldCandidate}
                        acceptLabel="Accept and publish"
                        note="Publishes straight away when it has a pin and a way to get in touch. The reader never guesses coordinates, so most of these need the pin from you."
                        fields={[
                          { name: 'name', label: 'Name', value: ex.name ?? meta.title ?? '', wide: true, evidence: ev.name },
                          { name: 'teamNumber', label: 'Team', type: 'number', value: ex.teamNumber ?? row.teamNumber, evidence: ev.teamNumber },
                          { name: 'teamName', label: 'Team name', value: ex.teamName, evidence: ev.teamName },
                          { name: 'program', label: 'Program', type: 'select', options: FIELD_PROGRAMS, value: ex.program, evidence: ev.program },
                          { name: 'address', label: 'Address', value: ex.address, wide: true, evidence: ev.address },
                          { name: 'city', label: 'City', value: ex.city, evidence: ev.city },
                          { name: 'region', label: 'State', value: ex.region, evidence: ev.region },
                          { name: 'country', label: 'Country', value: ex.country, evidence: ev.country },
                          { name: 'hours', label: 'Hours', value: ex.hours, wide: true, evidence: ev.hours },
                          { name: 'availability', label: 'Availability', type: 'select', options: FIELD_AVAILABILITY, value: ex.availability, evidence: ev.availability },
                          { name: 'coverage', label: 'Coverage', type: 'select', options: FIELD_COVERAGE, value: ex.coverage, evidence: ev.coverage },
                          { name: 'perimeter', label: 'Perimeter', type: 'select', options: FIELD_PERIMETER, value: ex.perimeter, evidence: ev.perimeter },
                          { name: 'elements', label: 'Elements', type: 'select', options: FIELD_ELEMENTS, value: ex.elements, evidence: ev.elements },
                          { name: 'hasFms', label: 'Has an FMS', type: 'checkbox', value: ex.hasFms, evidence: ev.hasFms },
                          { name: 'ceilingHeightFt', label: 'Ceiling (ft)', type: 'number', value: ex.ceilingHeightFt, evidence: ev.ceilingHeightFt },
                          { name: 'contactInfo', label: 'Contact', value: ex.contactInfo, wide: true, evidence: ev.contactInfo },
                          { name: 'contactUrl', label: 'Booking link', value: ex.contactUrl, wide: true, evidence: ev.contactUrl },
                          { name: 'website', label: 'Website', value: ex.website, wide: true, evidence: ev.website },
                          { name: 'notes', label: 'Notes', type: 'textarea', value: ex.notes, wide: true, evidence: ev.notes },
                        ]}
                      />
                    ) : (
                      <ExtractedList
                        rows={[
                          ['name', ex.name],
                          ['team', ex.teamNumber ?? row.teamNumber],
                          ['place', place],
                          ['hours', ex.hours],
                          ['contact', ex.contactInfo],
                        ]}
                        evidence={meta.readEvidence}
                        keys={{ team: 'teamNumber', place: 'city', contact: 'contactInfo' }}
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
                      signals={meta.signals}
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
                    matchedLabel={fieldId ? `field: ${fieldName ?? fieldId} (${fieldStatus ?? 'unknown'})` : null}
                    refPlaceholder="field id or team number"
                    attach={attachFieldCandidate}
                    suppress={suppressFieldCandidate}
                    markDuplicate={markFieldCandidateDuplicate}
                    reopen={reopenFieldCandidate}
                  />
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/practice-fields/candidates?status=${status}&page=${n}`} />
    </div>
  )
}
