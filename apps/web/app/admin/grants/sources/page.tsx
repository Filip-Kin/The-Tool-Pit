import Link from 'next/link'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCandidates, grantCrawlJobs, grantSources } from '@the-tool-pit/db'
import { readBraveBudget } from '@/lib/admin/grants'
import { GrantSourceControls } from './source-actions'

/**
 * Discovery sources and what they actually produce.
 *
 * Yield and reject are the two numbers that matter. A source with a high reject
 * count is not "a bit noisy", it is a source that costs a person time on every
 * pass, and it belongs switched off. They are shown side by side with the
 * accept rate so that call takes a glance rather than a query.
 *
 * The Brave budget sits at the top because it is a hard monthly spend limit,
 * not a soft one, and a sweep that stopped early because the budget ran out
 * looks identical to a sweep that found nothing.
 */

const RECENT_JOBS = 15

export default async function AdminGrantSourcesPage() {
  await assertAdmin()
  const db = getDb()

  const [sources, jobs, candidateCounts, budget] = await Promise.all([
    db.select().from(grantSources).orderBy(desc(grantSources.enabled), asc(grantSources.kind), asc(grantSources.label)),
    db
      .select({ job: grantCrawlJobs, sourceLabel: grantSources.label })
      .from(grantCrawlJobs)
      .leftJoin(grantSources, eq(grantSources.id, grantCrawlJobs.sourceId))
      .orderBy(desc(grantCrawlJobs.createdAt))
      .limit(RECENT_JOBS),
    db
      .select({ sourceId: grantCandidates.sourceId, status: grantCandidates.status, count: sql<number>`count(*)::int` })
      .from(grantCandidates)
      .groupBy(grantCandidates.sourceId, grantCandidates.status),
    readBraveBudget(),
  ])

  // Live pending count per source: the tallies on the row are lifetime, and a
  // pile of undecided candidates is a different problem from a bad source.
  const pendingBySource = new Map<string, number>()
  for (const c of candidateCounts) {
    if (c.status !== 'pending' || !c.sourceId) continue
    pendingBySource.set(c.sourceId, (pendingBySource.get(c.sourceId) ?? 0) + c.count)
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <Link href="/admin/grants" className="text-xs text-muted hover:text-foreground">
          ← Grants
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Discovery sources</h1>
      </div>

      {/* #region Brave budget */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Brave Search budget, this month</h2>
        {budget ? (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-6">
              <Figure label={`used (${budget.month} UTC)`} value={budget.used.toLocaleString()} />
              <Figure label="cap" value={budget.cap.toLocaleString()} />
              <Figure
                label="remaining"
                value={budget.remaining.toLocaleString()}
                tone={budget.remaining === 0 ? 'bad' : budget.remaining < budget.cap * 0.1 ? 'warn' : 'good'}
              />
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full ${
                  budget.remaining === 0 ? 'bg-frc' : budget.remaining < budget.cap * 0.1 ? 'bg-official' : 'bg-rookie'
                }`}
                style={{ width: `${budget.cap > 0 ? Math.min(100, (budget.used / budget.cap) * 100) : 100}%` }}
              />
            </div>
            {budget.remaining === 0 && (
              <p className="mt-3 text-xs text-frc">
                The cap is spent. Web-search discovery is refusing queries until the counter rolls over at the
                start of next month UTC. That is a coverage gap, not an empty internet.
              </p>
            )}
            <p className="mt-3 text-[10px] text-muted-2">
              Counter lives in Redis under grants:brave:spend:{budget.month} and is incremented by the worker,
              which is the thing enforcing the cap. Raise it with BRAVE_MONTHLY_QUERY_CAP in both the worker and
              the web app.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-official">
            Could not read the budget from Redis. Treat it as unknown, not as unspent: the worker is still
            enforcing whatever the counter says.
          </p>
        )}
      </section>
      {/* #endregion */}

      {/* #region sources */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-muted">
            No sources configured. Discovery has nothing to sweep, so the candidate queue will stay empty.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="min-w-[36rem] w-full text-sm">
                            <thead className="bg-surface-2 text-xs text-muted">
                              <tr>
                                <th className="px-4 py-2 text-left">Source</th>
                                <th className="w-28 px-4 py-2 text-left">Cadence</th>
                                <th className="w-44 px-4 py-2 text-left">Last run</th>
                                <th className="w-40 px-4 py-2 text-left">Yield / reject</th>
                                <th className="w-56 px-4 py-2 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sources.map((s) => {
                                const decided = s.yieldCount + s.rejectCount
                                const acceptRate = decided > 0 ? Math.round((s.yieldCount / decided) * 100) : null
                                const overdue =
                                  s.enabled && (!s.lastRunAt || Date.now() - new Date(s.lastRunAt).getTime() > s.cadenceHours * 3_600_000)
                                const pending = pendingBySource.get(s.id) ?? 0
                                return (
                                  <tr key={s.id} className={`border-t border-border-subtle align-top ${s.enabled ? '' : 'opacity-50'}`}>
                                    <td className="max-w-sm px-4 py-3">
                                      <p className="text-xs font-medium text-foreground">{s.label}</p>
                                      <p className="font-mono text-[10px] text-muted-2">{s.kind}</p>
                                      <p className="mt-0.5 line-clamp-2 break-all text-[10px] text-muted" title={s.target}>
                                        {s.target}
                                      </p>
                                      {!s.enabled && <p className="mt-1 text-[10px] text-muted-2">switched off</p>}
                                      {pending > 0 && (
                                        <p className="mt-1 text-[10px] text-official">{pending} candidates still undecided</p>
                                      )}
                                      {s.notes && <p className="mt-1 text-[10px] text-muted-2">{s.notes}</p>}
                                    </td>

                                    <td className="px-4 py-3 text-xs text-muted">
                                      every {s.cadenceHours}h
                                      {overdue && <span className="mt-0.5 block text-[10px] text-official">due</span>}
                                    </td>

                                    <td className="px-4 py-3 text-[10px]">
                                      <p className="text-muted">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'never run'}</p>
                                      {s.lastError && <p className="mt-1 text-frc">{s.lastError.slice(0, 120)}</p>}
                                    </td>

                                    <td className="px-4 py-3 text-xs">
                                      <span className="text-rookie">{s.yieldCount}</span>
                                      <span className="text-muted-2"> / </span>
                                      <span className="text-frc">{s.rejectCount}</span>
                                      {acceptRate != null && (
                                        <p
                                          className={`mt-0.5 text-[10px] ${
                                            acceptRate < 20 ? 'text-frc' : acceptRate < 50 ? 'text-official' : 'text-muted-2'
                                          }`}
                                        >
                                          {acceptRate}% of decided candidates were kept
                                        </p>
                                      )}
                                    </td>

                                    <td className="px-4 py-3 text-right">
                                      <GrantSourceControls sourceId={s.id} enabled={s.enabled} cadenceHours={s.cadenceHours} />
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
            </div>
          </div>
        )}
      </section>
      {/* #endregion */}

      {/* #region recent jobs */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Recent runs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">No discovery runs yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="min-w-[36rem] w-full text-sm">
                            <thead className="bg-surface-2 text-xs text-muted">
                              <tr>
                                <th className="px-4 py-2 text-left">Connector</th>
                                <th className="w-24 px-4 py-2 text-left">Status</th>
                                <th className="px-4 py-2 text-left">Result</th>
                                <th className="w-44 px-4 py-2 text-left">When</th>
                              </tr>
                            </thead>
                            <tbody>
                              {jobs.map(({ job, sourceLabel }) => {
                                const stats = (job.stats ?? {}) as Record<string, unknown>
                                const limits = Array.isArray(stats.limits) ? (stats.limits as string[]) : []
                                const errors = Array.isArray(stats.errors) ? (stats.errors as string[]) : []
                                const n = (k: string) => (typeof stats[k] === 'number' ? (stats[k] as number) : 0)
                                return (
                                  <tr key={job.id} className="border-t border-border-subtle align-top">
                                    <td className="px-4 py-2">
                                      <p className="font-mono text-xs text-foreground">{job.connector}</p>
                                      {sourceLabel && <p className="text-[10px] text-muted-2">{sourceLabel}</p>}
                                    </td>
                                    <td className="px-4 py-2 text-xs">
                                      <span
                                        className={
                                          job.status === 'done' ? 'text-rookie' : job.status === 'failed' ? 'text-frc' : 'text-muted'
                                        }
                                      >
                                        {job.status}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 text-[10px] text-muted">
                                      {n('discovered')} found, {n('new')} new, {n('unchanged')} known, {n('skipped')} skipped,{' '}
                                      {n('failed')} failed
                                      {job.error && <p className="mt-1 text-frc">{job.error.slice(0, 160)}</p>}
                                      {/* A cap that bit is shown, never swallowed. A run cut off
                                          by a budget or a per-run limit is a partial sweep, and
                                          reading it as a complete one is how coverage silently
                                          shrinks. */}
                                      {limits.map((l) => (
                                        <p key={l} className="mt-1 text-official">
                                          coverage limit: {l}
                                        </p>
                                      ))}
                                      {errors.slice(0, 3).map((e) => (
                                        <p key={e} className="mt-1 text-frc">
                                          {e.slice(0, 160)}
                                        </p>
                                      ))}
                                      {errors.length > 3 && (
                                        <p className="mt-1 text-muted-2">and {errors.length - 3} more errors</p>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-[10px] text-muted-2">
                                      {new Date(job.createdAt).toLocaleString()}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
            </div>
          </div>
        )}
      </section>
      {/* #endregion */}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'bad' ? 'text-frc' : tone === 'warn' ? 'text-official' : 'text-foreground'
  return (
    <div>
      <p className={`text-2xl font-bold ${colour}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}
