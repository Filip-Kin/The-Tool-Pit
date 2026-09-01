import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCandidates, grantSources } from '@the-tool-pit/db'
import type { GrantClassification, RawGrantMetadata } from '@the-tool-pit/db'
import { CycleFields, GrantFields } from '../../grant-fields'
import { publishGrantCandidateForm } from '../actions'

/**
 * Publish editor for one candidate.
 *
 * This page is the human gate. The classification supplies the DEFAULTS in the
 * form and nothing else: the values that reach the `grants` table are the ones
 * submitted from here, and saving stamps verifiedAt / verifiedBy because a
 * person has just checked them. That stamp is what the public "verified on"
 * line reads, so it has to mean a person actually looked.
 *
 * The scraped page text sits next to the form rather than behind a link. The
 * point is to make checking a field cheaper than accepting it.
 */
export default async function AdminGrantCandidateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  await assertAdmin()
  const { id } = await params
  const { error } = await searchParams

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
  const url = cand.canonicalUrl ?? cand.sourceUrl
  const action = publishGrantCandidateForm.bind(null, id)

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <Link href="/admin/grants/candidates" className="text-xs text-muted hover:text-foreground">
          ← Candidates
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{cls.name || meta.title || 'Publish a candidate'}</h1>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block break-all text-xs text-primary hover:underline"
        >
          {url}
        </a>
      </div>

      {cand.matchedGrantId && (
        <p className="rounded-lg border border-official/40 bg-official/10 p-3 text-sm text-official">
          This candidate is already attached to a grant. Edit that grant instead of publishing a second copy.
        </p>
      )}

      {error && <p className="rounded-lg border border-frc/40 bg-frc/10 p-3 text-sm text-frc">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form action={action} className="flex flex-col gap-6">
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-1 text-sm font-semibold text-foreground">The listing</h2>
            <p className="mb-4 text-xs text-muted-2">
              Prefilled from the classifier. Correct every field against the funder&rsquo;s own page before
              saving. Leave a field blank rather than guessing at it.
            </p>
            <GrantFields
              defaults={{
                name: cls.name ?? meta.title ?? '',
                funderName: cls.funderName ?? meta.funderName ?? '',
                summary: cls.summary ?? meta.ogDescription ?? meta.description ?? '',
                infoUrl: url,
                applicationUrl: meta.applicationUrl ?? '',
                programs: cls.programs ?? ['any'],
                geoScope: cls.geoScope ?? 'national',
                countries: cls.countries ?? ['US'],
                regions: cls.regions ?? [],
                awardMin: cls.awardMin ?? null,
                awardMax: cls.awardMax ?? null,
                deadlineType: cls.deadlineType ?? 'unknown',
                // Default to pending, not published. Two decisions, not one:
                // saving the facts and putting them in front of teams.
                status: 'pending',
              }}
            />
          </section>

          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-1 text-sm font-semibold text-foreground">Opening cycle (optional)</h2>
            <p className="mb-4 text-xs text-muted-2">
              Only fill this in if the funder has published dates. A grant with no dates is still worth
              listing; an invented deadline is not. Leave the year blank to skip the cycle entirely.
            </p>
            <CycleFields defaults={{ sourceUrl: url }} />
          </section>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Save grant
            </button>
            <Link href="/admin/grants/candidates" className="text-sm text-muted hover:text-foreground">
              Cancel
            </Link>
            <span className="text-xs text-muted-2">Saving stamps you as the verifier.</span>
          </div>
        </form>

        <aside className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Classifier</h3>
            <dl className="mt-2 flex flex-col gap-1 text-xs">
              <Row label="Verdict" value={cls.isGrant === true ? 'grant' : cls.isGrant === false ? 'not a grant' : 'unclassified'} />
              <Row
                label="Confidence"
                value={
                  cand.confidenceScore != null
                    ? `${Math.round(cand.confidenceScore * 100)}%`
                    : cls.confidence != null
                      ? `${Math.round(cls.confidence * 100)}%`
                      : 'not scored'
                }
              />
              {cls.isAnnouncement && <Row label="Flag" value="looks like an award announcement" />}
              {cls.isAggregator && <Row label="Flag" value="looks like a list of grants" />}
            </dl>
            {cls.reasoning && <p className="mt-2 text-xs leading-snug text-muted">{cls.reasoning}</p>}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">How it was found</h3>
            <dl className="mt-2 flex flex-col gap-1 text-xs">
              <Row label="Source" value={row.sourceLabel ?? 'no source row'} />
              <Row label="Kind" value={row.sourceKind ?? 'unknown'} />
              {meta.discoveredVia && <Row label="Via" value={meta.discoveredVia} />}
              <Row label="Found" value={new Date(cand.createdAt).toLocaleString()} />
              {cand.submitterName && <Row label="Submitted by" value={cand.submitterName} />}
              {cand.submitterContact && <Row label="Contact" value={cand.submitterContact} />}
            </dl>
          </div>

          {meta.contentText && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Page text as scraped</h3>
              <p className="mt-1 text-[10px] text-muted-2">
                Boilerplate stripped and truncated. Check the live page before trusting a date off this.
              </p>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-snug text-muted">
                {meta.contentText}
              </pre>
            </div>
          )}
        </aside>
      </div>
    </div>
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
