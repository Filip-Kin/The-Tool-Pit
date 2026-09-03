import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatusChip } from '@/components/admin/status'
import { LocalTime } from '@/components/admin/local-time'
import { assertAdmin } from '@/lib/admin/auth'
import { getRosterCrawlDetail } from '../../../../_listing/reads-rosters-data'

/** The latest roster snapshot a team-list refresh produced for one event. */

export const dynamic = 'force-dynamic'

export default async function RosterCrawlDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await assertAdmin()
  const { id } = await params
  const detail = await getRosterCrawlDetail(id)
  if (!detail) notFound()

  const snap = detail.snapshot
  // A rejected snapshot is the suspect/leak flag: the refresh held it and kept
  // the last good count. The reason is on `error`.
  const suspect = snap?.status === 'rejected'

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href="/admin/event-listings/reads/rosters" className="text-xs text-muted hover:text-foreground">
          ← Team-list crawls
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{detail.name}</h1>
      </div>

      {/* Source of this event's roster */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-xs">
        <div className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          <span className="text-muted-2">public count</span>
          <span className="text-foreground">{detail.registeredTeamCount ?? '-'} teams</span>

          <span className="text-muted-2">TBA key</span>
          <span className="text-foreground">{detail.tbaKey ?? '-'}</span>

          <span className="text-muted-2">team-list page</span>
          {detail.teamListUrl ? (
            <a href={detail.teamListUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
              {detail.teamListUrl}
            </a>
          ) : (
            <span className="text-foreground">-</span>
          )}

          <span className="text-muted-2">site parser</span>
          <span className="text-foreground">
            {detail.hasParser ? (
              <>written{detail.parserUpdatedAt && <> <LocalTime value={detail.parserUpdatedAt} /></>}</>
            ) : (
              'none'
            )}
          </span>
        </div>
      </div>

      {/* The latest snapshot */}
      {!snap ? (
        <p className="text-sm text-muted">No roster snapshot has been taken for this event yet.</p>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Latest snapshot</h2>
            <StatusChip status={snap.status} />
            {snap.changed && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">changed</span>}
            <span className="text-[11px] text-muted-2"><LocalTime value={snap.fetchedAt} /></span>
          </div>

          {suspect && snap.error && (
            <p className="rounded border border-frc/40 bg-frc/10 px-3 py-2 text-xs text-frc">
              Held as suspect: {snap.error}. The last good count was kept and nothing public changed.
            </p>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-muted-2">
            <span className="text-foreground">{snap.teamCount ?? snap.teams.length} teams found</span>
            {snap.httpStatus != null && <span>HTTP {snap.httpStatus}</span>}
            <a href={snap.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
              {snap.sourceUrl}
            </a>
          </div>

          {snap.teams.length === 0 ? (
            <p className="text-xs text-muted">The snapshot parsed no teams.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {snap.teams.map((t, i) => (
                <span
                  key={`${t.number}-${t.robot ?? ''}-${i}`}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    t.waitlisted ? 'bg-surface-2 text-muted-2' : 'bg-surface-3 text-foreground'
                  }`}
                  title={t.name ?? undefined}
                >
                  {t.number}
                  {t.robot ? t.robot : ''}
                  {t.waitlisted && <span className="ml-1 text-[9px] uppercase">wl{t.waitlistPosition ? ` ${t.waitlistPosition}` : ''}</span>}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
