'use server'

import { revalidatePath } from 'next/cache'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { grantSources } from '@the-tool-pit/db'

const SOURCES_PATH = '/admin/grants/sources'

/**
 * Queue name and payload shape are SHARED WITH THE WORKER. The web app cannot
 * import from apps/worker, so `grant-discover` and the `{ connector, sourceId }`
 * payload are duplicated from apps/worker/src/grants/discover.ts
 * (GrantDiscoverPayload) and must be changed in both places together. A drift
 * here queues jobs nothing ever reads, which looks exactly like a source that
 * finds nothing.
 */
const GRANT_DISCOVER_QUEUE = 'grant-discover'

interface GrantDiscoverPayload {
  connector: string
  sourceId?: string
}

/**
 * Source kinds a connector actually answers to.
 *
 * ALSO SHARED WITH THE WORKER, and for the same reason as the queue name above:
 * these are the keys of GRANT_DISCOVER_CONNECTORS in
 * apps/worker/src/grants/discover.ts, which throws "Unknown grant discover
 * connector" on anything else. GRANT_SOURCE_KINDS is deliberately longer than
 * this list: 'aggregator' rows exist (the candidate queue creates them, see
 * ../candidates/actions.ts routeGrantCandidateToSource) but nothing crawls them
 * yet, and 'submission' and 'admin' are provenance labels rather than crawlers.
 * Checking here turns a job that fails in a worker log into a sentence on the
 * screen the admin is already looking at.
 */
const RUNNABLE_SOURCE_KINDS = new Set(['seed', 'web_search', 'team_sponsors', 'chief_delphi'])

let _queue: Queue<GrantDiscoverPayload> | undefined

function getDiscoverQueue(): Queue<GrantDiscoverPayload> {
  if (!_queue) {
    _queue = new Queue<GrantDiscoverPayload>(GRANT_DISCOVER_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 10_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    })
  }
  return _queue
}

/**
 * Requeue one source by hand.
 *
 * The connector is taken from the source row's own `kind`, not from anything
 * the browser sent, so this cannot be used to run an arbitrary connector name.
 * A disabled source is refused rather than quietly run: switching a noisy
 * source off has to actually mean off.
 */
export async function runGrantSource(sourceId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()
  const [source] = await db
    .select({ id: grantSources.id, kind: grantSources.kind, enabled: grantSources.enabled, label: grantSources.label })
    .from(grantSources)
    .where(eq(grantSources.id, sourceId))
    .limit(1)
  if (!source) return { error: 'Source not found.' }
  if (!source.enabled) return { error: `"${source.label}" is switched off. Enable it first if you want it to run.` }
  if (!RUNNABLE_SOURCE_KINDS.has(source.kind)) {
    return {
      error: `No crawler answers to kind "${source.kind}" yet, so "${source.label}" cannot run. The row is a confirmed target waiting for one.`,
    }
  }

  try {
    await getDiscoverQueue().add('grant-discover', { connector: source.kind, sourceId: source.id })
  } catch (err) {
    return { error: `Could not queue the job: ${String(err)}` }
  }

  revalidatePath(SOURCES_PATH)
  return {}
}

/**
 * Switch a source on or off. This is the point of the yield and reject columns
 * on this screen: a source producing nothing but award announcements gets
 * turned off rather than tolerated, and the counts are the evidence for it.
 */
export async function setGrantSourceEnabled(sourceId: string, enabled: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()
  const [source] = await db.select({ id: grantSources.id }).from(grantSources).where(eq(grantSources.id, sourceId)).limit(1)
  if (!source) return { error: 'Source not found.' }

  await db.update(grantSources).set({ enabled, updatedAt: new Date() }).where(eq(grantSources.id, sourceId))
  revalidatePath(SOURCES_PATH)
  return {}
}

/**
 * Change how often a source runs. Hours, because that is the column's unit and
 * a dropdown of "daily / weekly" would hide the fact that the scheduler works
 * in hours.
 */
export async function setGrantSourceCadence(sourceId: string, cadenceHours: number): Promise<{ error?: string }> {
  await assertAdmin()
  if (!Number.isFinite(cadenceHours) || cadenceHours < 1 || cadenceHours > 8760) {
    return { error: 'Cadence must be between 1 hour and a year.' }
  }
  const db = getDb()
  const [source] = await db.select({ id: grantSources.id }).from(grantSources).where(eq(grantSources.id, sourceId)).limit(1)
  if (!source) return { error: 'Source not found.' }

  await db
    .update(grantSources)
    .set({ cadenceHours: Math.round(cadenceHours), updatedAt: new Date() })
    .where(eq(grantSources.id, sourceId))
  revalidatePath(SOURCES_PATH)
  return {}
}
