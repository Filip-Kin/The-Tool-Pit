import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCandidates, grantSources } from '@the-tool-pit/db'
import type { GrantClassification, GrantExtraction, RawGrantMetadata } from '@the-tool-pit/db'
import { evidenceMap, extractionFillCount, reviewDefaults } from '@/lib/admin/grant-review'
import { publishGrantCandidateForm } from '../actions'
import { ReviewDeck } from './review-deck'

/**
 * One candidate, full screen, three answers.
 *
 * This used to be a form a moderator filled in by hand off a page they had to
 * go and read. There are 280 candidates, so that was never going to finish. The
 * extraction pass fills the record first and this screen is where a person
 * confirms it, with the quote that supports every value printed beside the box
 * it is in.
 *
 * The gate itself has not moved. Nothing here publishes on its own: what
 * reaches `grants` is what was submitted from this form, and saving still
 * stamps verifiedAt and verifiedBy because a person has just read it.
 */
export default async function AdminGrantCandidateDeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; status?: string }>
}) {
  await assertAdmin()
  const { id } = await params
  const { error, status: statusParam } = await searchParams

  const db = getDb()
  const [row] = await db
    .select({ candidate: grantCandidates, sourceLabel: grantSources.label, sourceKind: grantSources.kind })
    .from(grantCandidates)
    .leftJoin(grantSources, eq(grantSources.id, grantCandidates.sourceId))
    .where(eq(grantCandidates.id, id))
    .limit(1)
  if (!row) notFound()

  const cand = row.candidate
  const cls = (cand.classification ?? {}) as GrantClassification
  const meta = (cand.rawMetadata ?? {}) as RawGrantMetadata
  const extraction = (cand.extraction ?? null) as GrantExtraction | null
  const url = cand.canonicalUrl ?? cand.sourceUrl

  // The deck walks one status at a time, in the same order the queue lists it,
  // so "12 of 280" means the same thing on both screens. Only the ids are read:
  // the row itself is already loaded above.
  const queueStatus = statusParam ?? cand.status
  const queue = await db
    .select({ id: grantCandidates.id })
    .from(grantCandidates)
    .where(eq(grantCandidates.status, queueStatus))
    .orderBy(queueStatus === 'pending' ? desc(grantCandidates.confidenceScore) : desc(grantCandidates.updatedAt))

  const index = queue.findIndex((r) => r.id === id)
  const nextCandidateId = index >= 0 && index + 1 < queue.length ? queue[index + 1].id : null

  const defaults = reviewDefaults({ url, extraction, classification: cls, metadata: meta })

  return (
    <ReviewDeck
      candidateId={id}
      url={url}
      defaults={defaults}
      evidence={evidenceMap(extraction)}
      nextCandidateId={nextCandidateId}
      position={index >= 0 ? index + 1 : 1}
      queueTotal={queue.length}
      queueStatus={queueStatus}
      approveAction={publishGrantCandidateForm.bind(null, id)}
      fill={extractionFillCount(extraction)}
      extractedAt={cand.extractedAt ? cand.extractedAt.toISOString() : null}
      extractionDepth={extraction?.depth ?? null}
      extractionNotes={extraction?.notes ?? []}
      extractionReasoning={extraction?.reasoning ?? null}
      alreadyMatched={Boolean(cand.matchedGrantId)}
      error={error}
    >
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Triage and provenance</h3>
        <dl className="mt-2 flex flex-col gap-1 text-xs">
          <Row
            label="Verdict"
            value={cls.isGrant === true ? 'grant' : cls.isGrant === false ? 'not a grant' : 'unclassified'}
          />
          <Row
            label="Confidence"
            value={cand.confidenceScore != null ? `${Math.round(cand.confidenceScore * 100)}%` : 'not scored'}
          />
          {cls.isAnnouncement && <Row label="Flag" value="looks like an award announcement" />}
          {cls.isAggregator && <Row label="Flag" value="looks like a list of grants" />}
          <Row label="Source" value={row.sourceLabel ?? 'no source row'} />
          <Row label="Kind" value={row.sourceKind ?? 'unknown'} />
          {meta.discoveredVia && <Row label="Via" value={meta.discoveredVia} />}
          <Row label="Found" value={new Date(cand.createdAt).toLocaleString()} />
          {cand.submitterName && <Row label="Submitted by" value={cand.submitterName} />}
          {cand.reviewNote && <Row label="Flagged" value={cand.reviewNote} />}
        </dl>
        {cls.reasoning && <p className="mt-2 text-xs leading-snug text-muted">{cls.reasoning}</p>}
      </div>

      {extraction && extraction.evidenceUrls.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Pages read</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {extraction.evidenceUrls.map((u) => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all text-[10px] text-primary hover:underline"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(meta.description || meta.ogDescription) && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Third-party summary</h3>
          <p className="mt-1 text-[10px] text-muted-2">
            Written by whoever listed this grant, not by the funder. Good on eligibility, sometimes out of date.
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug text-muted">
            {meta.description ?? meta.ogDescription}
          </p>
        </div>
      )}

      {meta.contentText && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Page text as scraped</h3>
          <p className="mt-1 text-[10px] text-muted-2">
            Boilerplate stripped and truncated. Open the live page before trusting a date off this.
          </p>
          <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-[10px] leading-snug text-muted">
            {meta.contentText}
          </pre>
        </div>
      )}

      <Link
        href={`/admin/grants/candidates?status=${queueStatus}`}
        className="text-xs text-muted hover:text-foreground"
      >
        Back to the queue
      </Link>
    </ReviewDeck>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-2">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  )
}
