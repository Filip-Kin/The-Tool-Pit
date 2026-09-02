import { desc, sql, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { events, albums, albumCandidates, albumCrawlJobs } from '@the-tool-pit/db'
import type { AlbumCrawlStats } from '@the-tool-pit/db'
import { AlbumSourceTrigger } from './album-source-triggers'
import { assertAdmin } from '@/lib/admin/auth'

const CONNECTORS = [
  { connector: 'tba_events', label: 'Sync TBA events (FRC)' },
  { connector: 'toa_events', label: 'Sync TOA events (FTC)' },
  { connector: 'fim_albums', label: 'Crawl First in Michigan' },
  { connector: 'chief_delphi_albums', label: 'Search Chief Delphi' },
  { connector: 'flickr_albums', label: 'Scrape Flickr accounts' },
  { connector: 'smugmug_albums', label: 'Crawl SmugMug sites' },
  { connector: 'reanalyze_candidates', label: 'Re-analyze candidates' },
]

export default async function AdminAlbumSourcesPage() {
  await assertAdmin()
  const db = getDb()
  const [[{ eventCount }], [{ albumCount }], [{ pendingCount }], jobs] = await Promise.all([
    db.select({ eventCount: sql<number>`count(*)::int` }).from(events),
    db.select({ albumCount: sql<number>`count(*)::int` }).from(albums).where(eq(albums.status, 'published')),
    db.select({ pendingCount: sql<number>`count(*)::int` }).from(albumCandidates).where(eq(albumCandidates.status, 'pending')),
    db.select().from(albumCrawlJobs).orderBy(desc(albumCrawlJobs.createdAt)).limit(20),
  ])

  return (
    <div className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-bold text-foreground">Album Sources</h1>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Events" value={eventCount} />
        <Stat label="Published albums" value={albumCount} />
        <Stat label="Pending candidates" value={pendingCount} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Run a source</h2>
        <div className="flex flex-wrap gap-3">
          {CONNECTORS.map((c) => (
            <AlbumSourceTrigger key={c.connector} connector={c.connector} label={c.label} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-2">
          Sync TBA events first so scraped albums can be matched to real events.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">No jobs yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="min-w-[36rem] w-full text-sm">
                            <thead className="bg-surface-2 text-xs text-muted">
                              <tr>
                                <th className="px-4 py-2 text-left">Connector</th>
                                <th className="px-4 py-2 text-left">Status</th>
                                <th className="px-4 py-2 text-left">Stats</th>
                                <th className="px-4 py-2 text-left">When</th>
                              </tr>
                            </thead>
                            <tbody>
                              {jobs.map((j) => {
                                const s = (j.stats ?? {}) as Partial<AlbumCrawlStats>
                                return (
                                  <tr key={j.id} className="border-t border-border-subtle">
                                    <td className="px-4 py-2 font-mono text-xs text-foreground">{j.connector}</td>
                                    <td className="px-4 py-2">
                                      <span
                                        className={
                                          j.status === 'done'
                                            ? 'text-official'
                                            : j.status === 'failed'
                                              ? 'text-frc'
                                              : 'text-muted'
                                        }
                                      >
                                        {j.status}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 text-xs text-muted">
                                      {j.connector === 'tba_events'
                                        ? `${s.eventsUpserted ?? 0} events, ${s.eventTeamsUpserted ?? 0} teams`
                                        : `${s.discovered ?? 0} found, ${s.new ?? 0} new, ${s.skipped ?? 0} skipped`}
                                      {j.error && <span className="text-frc"> · {j.error.slice(0, 60)}</span>}
                                    </td>
                                    <td className="px-4 py-2 text-xs text-muted-2">
                                      {new Date(j.createdAt).toLocaleString()}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}
