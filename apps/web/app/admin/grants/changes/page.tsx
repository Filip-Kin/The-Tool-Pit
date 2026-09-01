import Link from 'next/link'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantChanges, grantSnapshots, grants } from '@the-tool-pit/db'
import { formatChangeValue, resolveChangeField } from '@/lib/admin/grants'
import { GrantChangeActions } from './change-actions'

/**
 * The change queue.
 *
 * A monitor pass never writes a new deadline onto a published listing. It files
 * a row here and stops. Applying one is the ONLY route a scraped date has onto
 * the public grants list, which is why this screen is built the way it is:
 *
 *   - grouped by grant, so a page that moved three fields is read as one story
 *     rather than three unrelated rows,
 *   - deadline-class changes sorted to the top of every group and marked, since
 *     those are the ones a team loses money over,
 *   - the before and after spelled out in full, with the timestamp shown in UTC
 *     rather than a friendly relative date, because "11:59pm ET" versus
 *     "11:59pm PT" is exactly the difference that matters,
 *   - apply gated behind a tickbox and a browser confirm for anything that
 *     moves a date. The server action re-checks the tickbox; the UI is the
 *     speed bump, not the guard.
 */

const STATUS_TABS = ['pending', 'applied', 'dismissed'] as const
type TabStatus = (typeof STATUS_TABS)[number]
const MAX_CHANGES = 300

export default async function AdminGrantChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus) ? params.status : 'pending') as TabStatus

  const db = getDb()
  const [rows, counts] = await Promise.all([
    db
      .select({
        change: grantChanges,
        grantId: grants.id,
        grantName: grants.name,
        grantSlug: grants.slug,
        grantStatus: grants.status,
        snapshotUrl: grantSnapshots.url,
        snapshotFetchedAt: grantSnapshots.fetchedAt,
      })
      .from(grantChanges)
      .innerJoin(grants, eq(grants.id, grantChanges.grantId))
      .leftJoin(grantSnapshots, eq(grantSnapshots.id, grantChanges.snapshotId))
      .where(eq(grantChanges.status, status))
      .orderBy(asc(grants.name), desc(grantChanges.createdAt))
      .limit(MAX_CHANGES),
    db
      .select({ status: grantChanges.status, count: sql<number>`count(*)::int` })
      .from(grantChanges)
      .groupBy(grantChanges.status),
  ])

  const countMap: Record<string, number> = Object.fromEntries(counts.map((r) => [r.status, r.count]))

  // Resolve each filed path against the apply allowlist here, once. A path the
  // allowlist does not know is still shown, flagged, because a silently hidden
  // change is a deadline nobody ever reviews.
  const decorated = rows.map((r) => {
    const resolved = resolveChangeField(r.change.field)
    return {
      ...r,
      target: resolved?.target ?? null,
      cycleYear: resolved?.cycleYear,
      priority: resolved?.target.priority ?? 3,
    }
  })

  const groups = new Map<string, typeof decorated>()
  for (const row of decorated) {
    const list = groups.get(row.grantId) ?? []
    list.push(row)
    groups.set(row.grantId, list)
  }
  // Deadline first, inside each group and between groups. A reworded summary
  // must never sit above a date that moved.
  const ordered = [...groups.values()]
    .map((list) => [...list].sort((a, b) => a.priority - b.priority || +new Date(b.change.createdAt) - +new Date(a.change.createdAt)))
    .sort((a, b) => a[0].priority - b[0].priority || a[0].grantName.localeCompare(b[0].grantName))

  const truncated = rows.length === MAX_CHANGES

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/grants" className="text-xs text-muted hover:text-foreground">
            ← Grants
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Changes</h1>
        </div>
        <p className="text-sm text-muted">{rows.length.toLocaleString()} {status}</p>
      </div>

      <p className="max-w-3xl rounded-lg border border-border-subtle bg-surface p-3 text-xs text-muted">
        Applying a change is the only way a scraped date reaches a published listing, and it stamps you
        as the person who checked it. Open the funder&rsquo;s page first. If the page is ambiguous,
        dismiss with a note rather than applying something that is probably right.
      </p>

      <div className="flex gap-1 border-b border-border-subtle">
        {STATUS_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/grants/changes?status=${s}`}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm capitalize transition-colors ${
              status === s ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-foreground'
            }`}
          >
            {s}
            {countMap[s] != null && (
              <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{countMap[s]}</span>
            )}
          </Link>
        ))}
      </div>

      {truncated && (
        <p className="rounded-lg border border-official/40 bg-official/10 p-3 text-xs text-official">
          Showing the first {MAX_CHANGES} only. There are more {status} changes than fit on one screen, so
          this list is not the whole queue.
        </p>
      )}

      {ordered.length === 0 ? (
        <p className="text-sm text-muted">No {status} changes.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {ordered.map((group) => {
            const head = group[0]
            return (
              <section key={head.grantId} className="overflow-hidden rounded-lg border border-border">
                <header className="flex flex-wrap items-baseline justify-between gap-2 bg-surface-2 px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <Link href={`/admin/grants/${head.grantId}`} className="text-sm font-semibold text-foreground hover:text-primary">
                      {head.grantName}
                    </Link>
                    <span className="text-[10px] text-muted-2">/grants/{head.grantSlug}</span>
                    {head.grantStatus !== 'published' && (
                      <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{head.grantStatus}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-2">
                    {group.length} change{group.length === 1 ? '' : 's'}
                  </span>
                </header>

                <div className="divide-y divide-border-subtle">
                  {group.map((row) => {
                    const c = row.change
                    const type = row.target?.type ?? 'text'
                    const isDeadline = row.priority === 0
                    const label = row.target
                      ? row.cycleYear
                        ? `${row.target.label} (${row.cycleYear})`
                        : row.target.label
                      : c.field
                    const newText = formatChangeValue(c.newValue, type)
                    return (
                      <div key={c.id} className={`flex flex-wrap gap-4 p-4 ${isDeadline ? 'bg-official/5' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">{label}</span>
                            {isDeadline && (
                              <span className="rounded bg-official/20 px-1.5 py-0.5 text-[10px] font-medium text-official">
                                deadline class
                              </span>
                            )}
                            {c.autoApplicable && (
                              <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
                                new cycle, additive
                              </span>
                            )}
                            <span className="font-mono text-[10px] text-muted-2">{c.field}</span>
                          </div>

                          {!row.target && (
                            <p className="mt-1.5 text-[11px] text-frc">
                              This path is not on the apply allowlist, so it cannot be written. Dismiss it and
                              fix the extractor.
                            </p>
                          )}

                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <ValueBox tone="old" label="Now" text={formatChangeValue(c.oldValue, type)} />
                            <ValueBox tone="new" label="Proposed" text={newText} />
                          </div>

                          {c.reasoning && (
                            <p className="mt-2 whitespace-pre-wrap text-[11px] leading-snug text-muted">{c.reasoning}</p>
                          )}

                          <p className="mt-2 text-[10px] text-muted-2">
                            filed {new Date(c.createdAt).toLocaleString()}
                            {row.snapshotFetchedAt && ` · page fetched ${new Date(row.snapshotFetchedAt).toLocaleString()}`}
                            {c.reviewedBy && ` · ${c.status} by ${c.reviewedBy}`}
                          </p>
                          {row.snapshotUrl && (
                            <a
                              href={row.snapshotUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 block break-all text-[10px] text-primary hover:underline"
                            >
                              {row.snapshotUrl}
                            </a>
                          )}
                        </div>

                        <div className="shrink-0">
                          <GrantChangeActions
                            changeId={c.id}
                            status={c.status}
                            isDeadline={isDeadline}
                            fieldLabel={label}
                            newValueText={newText}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Before and after side by side, both spelled out. No ellipsis on a date. */
function ValueBox({ tone, label, text }: { tone: 'old' | 'new'; label: string; text: string }) {
  return (
    <div
      className={`rounded border p-2 ${
        tone === 'new' ? 'border-primary/40 bg-primary-subtle/40' : 'border-border-subtle bg-surface-2'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-2">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground">{text}</p>
    </div>
  )
}
