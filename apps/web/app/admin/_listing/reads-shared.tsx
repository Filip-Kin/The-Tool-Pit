import Link from 'next/link'
import { LocalTime } from '@/components/admin/local-time'
import type { WorkerQueueRow } from '@/lib/admin/queue-counts'
import type { ReadDetail, ReadListRow, ReadsOverview } from './reads-data'

/**
 * The presentational half of the reads inspector, shared by both verticals.
 *
 * The data comes from reads-data.ts; these components only render it. Kept
 * beside the candidate-evidence panels they echo (a page read, a quote, a source
 * badge) so the two views of a read read the same.
 */

/** A page URL shortened to something readable. */
function shortUrl(source: string): string {
  if (source === 'thread') return 'thread'
  try {
    const url = new URL(source)
    const path = url.pathname.replace(/\/$/, '')
    return `${url.host.replace(/^www\./, '')}${path.length > 1 ? path : ''}`
  } catch {
    return source
  }
}

/**
 * The tab strip on top of every "Reads & crawls" inspector.
 *
 * Each vertical shows the tabs it actually has. All of them are "what an
 * automated pass produced": a candidate read, a roster refresh, or a discovery
 * crawl. The discovery crawl-jobs table used to be one shared /admin/crawls
 * screen reached from a separate sidebar link per vertical; it is a tab here now
 * so one observability entry per vertical holds all of it.
 *
 * A vertical with only one tab (tools, photos, grants have no candidate-read
 * pass) still renders the strip, so the header reads the same everywhere.
 */
export type ReadsVertical = 'events' | 'fields' | 'tools' | 'photos' | 'grants'
export type ReadsTabKey = 'reads' | 'rosters' | 'crawls'

const READS_TABS: Record<ReadsVertical, { key: ReadsTabKey; label: string; href: string }[]> = {
  events: [
    { key: 'reads', label: 'Candidate reads', href: '/admin/event-listings/reads' },
    { key: 'rosters', label: 'Team-list crawls', href: '/admin/event-listings/reads/rosters' },
    { key: 'crawls', label: 'Crawl jobs', href: '/admin/event-listings/reads/crawls' },
  ],
  fields: [
    { key: 'reads', label: 'Candidate reads', href: '/admin/practice-fields/reads' },
    { key: 'crawls', label: 'Crawl jobs', href: '/admin/practice-fields/reads/crawls' },
  ],
  tools: [{ key: 'crawls', label: 'Crawl jobs', href: '/admin/tools/reads' }],
  photos: [{ key: 'crawls', label: 'Crawl jobs', href: '/admin/album-candidates/reads' }],
  grants: [{ key: 'crawls', label: 'Crawl jobs', href: '/admin/grants/reads' }],
}

export function ReadsTabs({ vertical, active }: { vertical: ReadsVertical; active: ReadsTabKey }) {
  const tabs = READS_TABS[vertical]
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            t.key === active
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted hover:text-foreground'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}

/** ✓ read <when> / not read yet. */
export function ReadStatus({ readAt }: { readAt: string | null }) {
  if (!readAt) return <span className="text-muted-2">not read yet</span>
  return (
    <span className="text-official">
      <span aria-hidden>✓</span> read <LocalTime value={readAt} />
    </span>
  )
}

/**
 * The progress summary: "N of M read" with a bar, plus the live BullMQ state of
 * the read-candidates queue (waiting / active / failed).
 */
export function ReadsProgress({
  overview,
  queue,
}: {
  overview: ReadsOverview
  queue: WorkerQueueRow | null
}) {
  const pct = overview.total === 0 ? 0 : Math.round((overview.read / overview.total) * 100)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {overview.read.toLocaleString()} of {overview.total.toLocaleString()} candidates read
        </p>
        <p className="text-xs text-muted-2">
          {overview.pendingUnread.toLocaleString()} pending and unread
        </p>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-official transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>

      {queue && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-2">reading queue</span>
          <QueueChip label="waiting" value={queue.waiting} />
          <QueueChip label="active" value={queue.active} live={queue.active > 0} />
          <QueueChip label="failed" value={queue.failed} bad={queue.failed > 0} />
          {queue.oldestWaitingAt && (
            <span className="text-muted-2">oldest queued <LocalTime value={queue.oldestWaitingAt} /></span>
          )}
        </div>
      )}
    </div>
  )
}

function QueueChip({ label, value, live, bad }: { label: string; value: number; live?: boolean; bad?: boolean }) {
  const tone = bad && value > 0 ? 'bg-frc/15 text-frc' : live ? 'bg-official/20 text-official' : 'bg-surface-3 text-muted'
  return (
    <span className={`rounded px-1.5 py-0.5 font-medium ${tone}`}>
      {value} {label}
    </span>
  )
}

/** The candidate list: one row per read, newest read first. */
export function ReadsListRows({ rows, basePath }: { rows: ReadListRow[]; basePath: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">No candidates yet. Sweeps run overnight.</p>
  }

  return (
    <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border bg-surface">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`${basePath}/${row.id}`}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
            <p className="text-[11px]">
              <ReadStatus readAt={row.readAt} />
              {row.status !== 'pending' && <span className="text-muted-2"> · {row.status}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-2">
            <span>{row.pagesCount} pages</span>
            <span>{row.fieldsCount} fields</span>
            {row.rejectedCount > 0 && <span className="text-muted">{row.rejectedCount} rejected</span>}
            <span aria-hidden>→</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

/** The "what did this specific read do" view. */
export function ReadDetailView({ detail }: { detail: ReadDetail }) {
  const url = detail.canonicalUrl ?? detail.sourceUrl
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
        <p className="text-[11px]">
          <ReadStatus readAt={detail.readAt} />
          {detail.status !== 'pending' && <span className="text-muted-2"> · {detail.status}</span>}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-xs text-primary hover:underline"
        >
          {url}
        </a>
      </div>

      {!detail.readAt ? (
        <p className="text-sm text-muted">
          This candidate has not been read yet, so there is nothing to show. A sweep reads pending
          candidates it has not seen; a re-read can be forced from the candidates screen.
        </p>
      ) : (
        <>
          {/* Pages opened, in order */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
              Pages opened ({detail.pages.length})
            </h2>
            {detail.pages.length === 0 ? (
              <p className="text-xs text-muted">No pages recorded.</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {detail.pages.map((p, i) => (
                  <li key={`${p}-${i}`} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 text-muted-2">{i + 1}.</span>
                    <a
                      href={p}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-muted hover:text-foreground hover:underline"
                    >
                      {p}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Evidence per field */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
              Evidence per field ({detail.evidence.length})
            </h2>
            {detail.evidence.length === 0 ? (
              <p className="text-xs text-muted">No field carried a quote on this read.</p>
            ) : (
              <dl className="flex flex-col gap-3">
                {detail.evidence.map((ev) => (
                  <div key={ev.field} className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-0.5">
                    <dt className="text-xs text-muted-2">{ev.field}</dt>
                    <dd className="flex min-w-0 flex-col gap-1">
                      <span className="break-words text-sm text-foreground">{ev.value ?? '—'}</span>
                      <span className="flex flex-wrap items-start gap-1.5 text-[11px] leading-snug">
                        <span className="shrink-0 rounded bg-official/20 px-1 py-px font-medium uppercase tracking-wide text-official">
                          {shortUrl(ev.source)}
                        </span>
                        <span className="min-w-0 break-words italic text-muted">“{ev.quote}”</span>
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {/* Rejected values */}
          {detail.rejected.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                Offered but unsupported, so dropped ({detail.rejected.length})
              </h2>
              <ul className="flex flex-col gap-1">
                {detail.rejected.map((r, i) => (
                  <li key={`${r}-${i}`} className="border-l-2 border-border pl-2 text-xs leading-snug text-muted">
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Final extracted fields */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
              Extracted fields ({detail.extracted.length})
            </h2>
            {detail.extracted.length === 0 ? (
              <p className="text-xs text-muted">Nothing was extracted.</p>
            ) : (
              <dl className="flex flex-col gap-1.5 text-xs">
                {detail.extracted.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[8rem_1fr] gap-x-3">
                    <dt className="text-muted-2">{label}</dt>
                    <dd className="min-w-0 break-words text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </>
      )}
    </div>
  )
}
