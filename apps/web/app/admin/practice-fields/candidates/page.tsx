import Link from 'next/link'
import { desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import {
  FIELD_CANDIDATE_STATUSES,
  practiceFieldCandidates,
  practiceFieldCrawlSources,
  practiceFields,
} from '@the-tool-pit/db'
import type { FieldCandidateStatus, ExtractedPracticeFieldFields, RawPracticeFieldMetadata } from '@the-tool-pit/db'
import { ExtractedList, EvidencePanel, StatusTabs } from '../../_listing/candidate-evidence'
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
  const [rows, [totals], counts] = await Promise.all([
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
    db
      .select({ status: practiceFieldCandidates.status, count: sql<number>`count(*)::int` })
      .from(practiceFieldCandidates)
      .groupBy(practiceFieldCandidates.status),
  ])

  const total = totals?.total ?? 0
  const countMap: Record<string, number> = Object.fromEntries(counts.map((r) => [r.status, r.count]))
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
        to be someone looking for one as someone offering one, and the connector cannot tell them
        apart. Accept writes a pending field with no pin and no spec.
      </p>

      <StatusTabs
        basePath="/admin/practice-fields/candidates"
        statuses={FIELD_CANDIDATE_STATUSES}
        active={status}
        counts={countMap}
        labels={TAB_LABELS}
      />

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

                <div className="mt-3 grid gap-5 md:grid-cols-2">
                  <ExtractedList
                    rows={[
                      ['name', ex.name],
                      ['team', ex.teamNumber ?? row.teamNumber],
                      ['team name', ex.teamName],
                      ['program', ex.program],
                      ['place', place],
                      ['website', ex.website],
                      ['contact form', ex.contactUrl],
                    ]}
                  />
                  <EvidencePanel
                    sourceUrl={row.sourceUrl}
                    canonicalUrl={row.canonicalUrl}
                    description={meta.description}
                    discoveredVia={meta.discoveredVia}
                    evidence={meta.evidence}
                    signals={meta.signals}
                    links={meta.links}
                  />
                </div>

                <div className="mt-4 border-t border-border-subtle pt-3">
                  <ListingCandidateActions
                    candidateId={row.id}
                    status={row.status}
                    defaultName={ex.name || meta.title || ''}
                    matchedLabel={fieldId ? `field: ${fieldName ?? fieldId} (${fieldStatus ?? 'unknown'})` : null}
                    refPlaceholder="field id or team number"
                    acceptedNote="Creates a pending field. Coverage, perimeter, elements and FMS land on their defaults and are not read from the thread, so set them before publishing."
                    accept={acceptFieldCandidate}
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

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/admin/practice-fields/candidates?status=${status}&page=${page - 1}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              ← Prev
            </Link>
          )}
          <span className="px-3 py-1.5 text-xs text-muted">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/practice-fields/candidates?status=${status}&page=${page + 1}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
