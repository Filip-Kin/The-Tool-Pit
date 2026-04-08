import type { Metadata } from 'next'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions, tools } from '@the-tool-pit/db'

interface PageProps {
  params: Promise<{ id: string }>
}

export const metadata: Metadata = {
  title: 'Submission Status',
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending:      { label: 'Pending',      className: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' },
  processing:   { label: 'Processing',   className: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' },
  published:    { label: 'Published',    className: 'bg-green-500/15 text-green-600 border-green-500/30' },
  needs_review: { label: 'Needs Review', className: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  duplicate:    { label: 'Duplicate',    className: 'bg-surface-2 text-muted border-border' },
  rejected:     { label: 'Rejected',     className: 'bg-red-500/15 text-red-500 border-red-500/30' },
}

const PIPELINE_STATUS_COLORS: Record<string, string> = {
  ok:   'text-green-600',
  warn: 'text-yellow-600',
  error: 'text-red-500',
  skip: 'text-muted',
}

export default async function SubmissionStatusPage({ params }: PageProps) {
  const { id } = await params

  // Basic UUID format check to avoid unnecessary DB query
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(id)) {
    return <NotFound />
  }

  const db = getDb()
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1)

  if (!submission) {
    return <NotFound />
  }

  let resolvedTool: { slug: string; name: string } | null = null
  if (submission.resolvedToolId) {
    const [tool] = await db
      .select({ slug: tools.slug, name: tools.name })
      .from(tools)
      .where(eq(tools.id, submission.resolvedToolId))
      .limit(1)
    resolvedTool = tool ?? null
  }

  const statusInfo = STATUS_STYLES[submission.status] ?? { label: submission.status, className: 'bg-surface-2 text-muted border-border' }
  const logEntries = (submission.pipelineLog ?? []).slice(-5).reverse()

  return (
    <div className="container mx-auto max-w-xl px-4 py-16">
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/submit" className="text-xs text-muted hover:text-foreground">
            ← Submit another tool
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-foreground">Submission Status</h1>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-4">
          {/* Status */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted">Status</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusInfo.className}`}>
              {statusInfo.label}
            </span>
          </div>

          {/* URL */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Submitted URL</span>
            <a
              href={submission.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-foreground hover:underline break-all"
            >
              {submission.url}
            </a>
          </div>

          {/* Submitted at */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted">Submitted</span>
            <span className="text-sm text-foreground">
              {new Date(submission.createdAt).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </span>
          </div>

          {/* Resolved tool link */}
          {resolvedTool && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
              <span className="text-sm font-medium text-green-700">Your tool is live!</span>
              <Link
                href={`/tools/${resolvedTool.slug}`}
                className="text-sm font-medium text-green-700 underline hover:no-underline"
              >
                View {resolvedTool.name} →
              </Link>
            </div>
          )}
        </div>

        {/* Pipeline log */}
        {logEntries.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted">Processing log</h2>
            <div className="rounded-lg border border-border divide-y divide-border-subtle overflow-hidden">
              {logEntries.map((entry, i) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2 bg-surface text-xs">
                  <span className={`shrink-0 font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[entry.status] ?? 'text-muted'}`}>
                    {entry.status}
                  </span>
                  <span className="text-muted font-mono">{entry.stage}</span>
                  {entry.message && (
                    <span className="text-muted-2 flex-1">{entry.message}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted text-center">
          Bookmark this page to check back later. Most submissions are processed within a few hours.
        </p>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="container mx-auto max-w-xl px-4 py-16 text-center flex flex-col gap-4">
      <p className="text-lg font-semibold text-foreground">Submission not found</p>
      <p className="text-sm text-muted">
        This link may be invalid or the submission may have been removed.
      </p>
      <Link href="/submit" className="text-sm text-primary underline hover:no-underline">
        Submit a tool →
      </Link>
    </div>
  )
}
