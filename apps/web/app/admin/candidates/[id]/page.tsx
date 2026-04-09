import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getDb } from '@/lib/db'
import { crawlCandidates, crawlJobs, tools, submissions } from '@the-tool-pit/db'
import { eq } from 'drizzle-orm'
import type { CandidateClassification, RawCandidateMetadata } from '@the-tool-pit/db'
import { CandidateDetailActions } from './candidate-detail-actions'

export default async function AdminCandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = getDb()

  const [candidate] = await db
    .select()
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, id))
    .limit(1)

  if (!candidate) notFound()

  const cls = (candidate.classification ?? {}) as CandidateClassification
  const meta = (candidate.rawMetadata ?? {}) as RawCandidateMetadata
  const confidence = candidate.confidenceScore ?? cls.confidence ?? 0

  // Fetch related job, matched tool, and originating submission in parallel
  const [jobRow, toolRow, submissionRow] = await Promise.all([
    candidate.jobId
      ? db.select().from(crawlJobs).where(eq(crawlJobs.id, candidate.jobId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    candidate.matchedToolId
      ? db.select({ id: tools.id, name: tools.name, slug: tools.slug })
          .from(tools).where(eq(tools.id, candidate.matchedToolId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    candidate.submissionId
      ? db.select({ id: submissions.id, url: submissions.url, status: submissions.status })
          .from(submissions).where(eq(submissions.id, candidate.submissionId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ])

  const displayUrl = candidate.canonicalUrl ?? candidate.sourceUrl

  return (
    <div className="p-8 max-w-3xl flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/candidates" className="text-xs text-muted hover:text-foreground">
            ← Candidates
          </Link>
          <h1 className="mt-1 text-xl font-bold text-foreground line-clamp-2">
            {meta.title ?? displayUrl}
          </h1>
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 text-xs text-primary hover:underline break-all"
          >
            {displayUrl}
          </a>
        </div>

        {/* Status badge */}
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize border ${
          candidate.status === 'published'
            ? 'bg-green-500/10 text-green-400 border-green-500/30'
            : candidate.status === 'suppressed'
              ? 'bg-red-500/10 text-red-400 border-red-500/30'
              : candidate.status === 'pending'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                : 'bg-surface-3 text-muted border-border'
        }`}>
          {candidate.status}
        </span>
      </div>

      {/* Confidence */}
      <section className="rounded-lg border border-border p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Classification</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${confidence >= 0.7 ? 'bg-green-500' : confidence >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${Math.round(confidence * 100)}%` }}
            />
          </div>
          <span className="text-sm font-medium text-foreground tabular-nums w-12 text-right">
            {Math.round(confidence * 100)}%
          </span>
        </div>

        {cls.reasoning && (
          <p className="text-xs text-muted italic">{cls.reasoning}</p>
        )}

        <div className="flex flex-wrap gap-2 mt-1">
          {cls.toolType && <Tag>{cls.toolType.replace(/_/g, ' ')}</Tag>}
          {(cls.programs ?? []).map((p) => <Tag key={p} color="program">{p.toUpperCase()}</Tag>)}
          {cls.isOfficial && <Tag color="official">official</Tag>}
          {cls.isVendor && <Tag color="vendor">vendor</Tag>}
          {cls.isRookieFriendly && <Tag color="rookie">rookie</Tag>}
          {cls.isTeamCode && <Tag>team code</Tag>}
          {cls.isTeamCad && <Tag>team CAD</Tag>}
          {cls.teamNumber && <Tag>Team {cls.teamNumber}</Tag>}
          {cls.seasonYear && <Tag>{cls.seasonYear}</Tag>}
        </div>

        {cls.summary && (
          <p className="text-sm text-foreground/80 mt-1">{cls.summary}</p>
        )}
      </section>

      {/* Raw metadata */}
      <section className="rounded-lg border border-border p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Raw Metadata</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          {meta.title && <><dt className="text-muted shrink-0">Title</dt><dd className="text-foreground">{meta.title}</dd></>}
          {meta.githubUrl && (
            <>
              <dt className="text-muted shrink-0">GitHub</dt>
              <dd>
                <a href={meta.githubUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{meta.githubUrl}</a>
                {typeof meta.githubStars === 'number' && <span className="ml-2 text-muted">★ {meta.githubStars}</span>}
              </dd>
            </>
          )}
          {meta.homepageUrl && (
            <>
              <dt className="text-muted shrink-0">Homepage</dt>
              <dd><a href={meta.homepageUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{meta.homepageUrl}</a></dd>
            </>
          )}
          {meta.chiefDelphiThreadUrl && (
            <>
              <dt className="text-muted shrink-0">CD Thread</dt>
              <dd>
                <a href={meta.chiefDelphiThreadUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{meta.chiefDelphiThreadUrl}</a>
                {typeof meta.chiefDelphiLikes === 'number' && <span className="ml-2 text-muted">♥ {meta.chiefDelphiLikes}</span>}
              </dd>
            </>
          )}
          {meta.description && (
            <>
              <dt className="text-muted shrink-0 pt-0.5">Description</dt>
              <dd className="text-foreground/80 break-words">{meta.description}</dd>
            </>
          )}
          {meta.keywords && meta.keywords.length > 0 && (
            <>
              <dt className="text-muted shrink-0">Keywords</dt>
              <dd className="text-muted break-words">{meta.keywords.join(', ')}</dd>
            </>
          )}
          <dt className="text-muted shrink-0">Source URL</dt>
          <dd><a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{candidate.sourceUrl}</a></dd>
          <dt className="text-muted shrink-0">Created</dt>
          <dd className="text-muted">{new Date(candidate.createdAt).toLocaleString()}</dd>
          {submissionRow && (
            <>
              <dt className="text-muted shrink-0">Submission</dt>
              <dd>
                <Link
                  href={`/admin/submissions?status=${submissionRow.status}`}
                  className="text-primary hover:underline text-xs"
                >
                  Manual submission ({submissionRow.status})
                </Link>
              </dd>
            </>
          )}
          {jobRow && (
            <>
              <dt className="text-muted shrink-0">Crawl Job</dt>
              <dd className="text-muted">{jobRow.connector} · {new Date(jobRow.createdAt).toLocaleDateString()}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Matched tool */}
      {toolRow && (
        <section className="rounded-lg border border-green-500/30 bg-green-500/5 p-5 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Published as Tool</h2>
          <div className="flex items-center gap-3">
            <Link
              href={`/admin/tools/${toolRow.id}`}
              className="text-sm text-primary hover:underline font-medium"
            >
              {toolRow.name}
            </Link>
            <span className="text-xs text-muted">/tools/{toolRow.slug}</span>
          </div>
        </section>
      )}

      {/* Rejection reason (if suppressed) */}
      {candidate.rejectionReason && (
        <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Rejection Reason</h2>
          <p className="text-sm text-red-400">{candidate.rejectionReason}</p>
        </section>
      )}

      {/* Actions */}
      <section className="rounded-lg border border-border p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground">Actions</h2>
        <CandidateDetailActions candidateId={candidate.id} status={candidate.status} />
      </section>
    </div>
  )
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode
  color?: 'program' | 'official' | 'vendor' | 'rookie'
}) {
  const colorMap = {
    program: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    official: 'bg-green-500/10 text-green-400 border-green-500/20',
    vendor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    rookie: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  }
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${
      color ? colorMap[color] : 'bg-surface-3 text-muted border-border-subtle'
    }`}>
      {children}
    </span>
  )
}
