/**
 * The weekly re-read of a published event, applying what changed.
 *
 * Runs inside the weekly event-status watch (same job, same Wednesday 06:40
 * slot), after the cancellation check for the same listing, and shares its
 * page reads. The rules for what may be written are in event-refresh-plan.ts;
 * this file reads, carries the plan out, and tells people.
 *
 * READ THE SAME WAY AS INTAKE. The Chief Delphi thread when there is one, the
 * event's own website otherwise or as well, through readEventCandidate: the
 * same prompt, the same validateEventRead, the same page tool. Nothing here
 * re-implements reading.
 *
 * CHEAP WHEN NOTHING MOVED. Before the model is asked anything, the thread and
 * the pages the last read used (website, team list page, and the pages the
 * reader opened last time) are fetched and hashed. The same hash as last week
 * means nothing to read, and costs no model call. The hash is stored only
 * after a read that left nothing unproven, so a value the model could not quote
 * last week gets another go.
 *
 * AFTER A WRITE. Dates or the team list page moved: an immediate roster refresh
 * for the listing, the same job the web app enqueues on publish (it runs right
 * after this one, the queue does one job at a time). A place moved: the pin is
 * geocoded again, kept as it was when the new place does not resolve. The
 * public event pages are force-dynamic, so they read the row on every request
 * and need no revalidation; the roster refresh's own count writes rely on the
 * same thing.
 */
import { createHash } from 'node:crypto'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { getDb, eventListings } from '@the-tool-pit/db'
import { sendApprovalNotice, siteUrl } from '@the-tool-pit/types'
import { fetchChiefDelphiTopic, parseChiefDelphiTopicId } from '../connectors/discourse.js'
import { normaliseForQuoteMatch, type NamedText } from '../model/evidence.js'
import { getRedis } from '../redis.js'
import { geocodeVenue } from './locate.js'
import { readEventCandidate } from './read-event.js'
import { planEventRefresh, type RefreshKey } from './event-refresh-plan.js'

/** Pages hashed per listing, at most. The reader opens up to 8. */
const MAX_HASHED_PAGES = 10
/** A stored hash outlives a missed week or two. */
const HASH_TTL_SECONDS = 60 * 86_400

export type RefreshOutcome = 'updated' | 'unchanged' | 'same_pages' | 'no_source' | 'unread'

export interface RefreshResult {
  outcome: RefreshOutcome
  applied: number
  held: number
}

interface StoredHash {
  hash: string
  pages: string[]
}

export function refreshHashKey(listingId: string): string {
  return `event-refresh:hash:${listingId}`
}

/** One hash over the thread and every page, in a fixed order, whitespace folded. */
export function sourceHash(threadText: string, pages: ReadonlyArray<{ url: string; text: string | null }>): string {
  const h = createHash('sha256')
  h.update(normaliseForQuoteMatch(threadText))
  for (const p of [...pages].sort((a, b) => a.url.localeCompare(b.url))) {
    h.update(`\n${p.url}\n`)
    h.update(normaliseForQuoteMatch(p.text ?? ''))
  }
  return h.digest('hex')
}

let rosterQueue: Queue<{ listingId: string }> | null = null

/** Same job the web app enqueues on publish. Best-effort. */
async function enqueueRosterRefresh(listingId: string): Promise<void> {
  try {
    rosterQueue ??= new Queue<{ listingId: string }>('roster-refresh', {
      connection: getRedis(),
      defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
    })
    await rosterQueue.add('roster-refresh', { listingId })
  } catch (err) {
    console.error(`[event-refresh] could not enqueue roster refresh for ${listingId}: ${String(err)}`)
  }
}

/**
 * Re-read one published event and apply what is proven.
 *
 * `readText` is the watch's page reader, memoised per run, so a page the
 * cancellation check already rendered is not rendered twice.
 */
export async function refreshPublishedEvent(
  listing: { id: string; name: string; website: string | null; teamListUrl: string | null; chiefDelphiUrl: string | null },
  readText: (url: string) => Promise<string | null>,
  today: string,
): Promise<RefreshResult> {
  if (!listing.chiefDelphiUrl && !listing.website) return { outcome: 'no_source', applied: 0, held: 0 }

  let threadText = ''
  const topicId = listing.chiefDelphiUrl ? parseChiefDelphiTopicId(listing.chiefDelphiUrl) : null
  if (topicId !== null) {
    const detail = await fetchChiefDelphiTopic(topicId)
    if (detail) threadText = detail.raw || detail.html.replace(/<[^>]+>/g, ' ')
  }

  // #region same pages as last week?
  const redis = getRedis()
  const key = refreshHashKey(listing.id)
  let stored: StoredHash | null = null
  try {
    const raw = await redis.get(key)
    stored = raw ? (JSON.parse(raw) as StoredHash) : null
  } catch {
    stored = null
  }

  const hashPages = async (urls: string[]) => {
    const unique = [...new Set(urls.filter(Boolean))].slice(0, MAX_HASHED_PAGES)
    const out: Array<{ url: string; text: string | null }> = []
    for (const url of unique) out.push({ url, text: await readText(url) })
    return out
  }
  const ownPages = [listing.website, listing.teamListUrl].filter((u): u is string => Boolean(u))

  if (stored) {
    const pages = await hashPages([...ownPages, ...stored.pages])
    if (pages.some((p) => p.text) && sourceHash(threadText, pages) === stored.hash) {
      return { outcome: 'same_pages', applied: 0, held: 0 }
    }
  }
  // #endregion

  const read = await readEventCandidate({
    threadUrl: listing.chiefDelphiUrl || listing.website || '',
    title: listing.name,
    threadText,
    website: listing.website ?? undefined,
  })
  if (!read) return { outcome: 'unread', applied: 0, held: 0 }

  // Fresh row after the model call, which takes a while: a person may have
  // claimed a field or the watch may have cancelled it in the meantime.
  const db = getDb()
  const [row] = await db.select().from(eventListings).where(eq(eventListings.id, listing.id)).limit(1)
  if (!row || row.status !== 'published' || (row.eventStatus !== 'tentative' && row.eventStatus !== 'confirmed')) {
    return { outcome: 'unchanged', applied: 0, held: 0 }
  }

  const sources: NamedText<string>[] = [
    ...(threadText ? [{ source: 'thread', text: threadText }] : []),
    ...read.pages.map((p) => ({ source: p.url, text: p.text })),
  ]
  const plan = planEventRefresh({
    current: row as unknown as Record<string, unknown> & { humanEditedFields: string[] | null },
    fields: read.fields as Partial<Record<RefreshKey, unknown>>,
    evidence: read.evidence as Record<string, { quote: string; source?: string } | undefined>,
    sources,
    today,
  })

  for (const h of plan.held) {
    console.log(`[event-refresh] ${row.name}: held ${h.key} (${h.reason}): ${h.from} -> ${h.to}`)
  }

  // EVENT_REFRESH_DRY=1: log the plan, write nothing, post nothing. For checking
  // a change to the rules against real pages before it goes live.
  if (process.env.EVENT_REFRESH_DRY === '1') {
    for (const c of plan.applied) console.log(`[event-refresh] DRY ${row.name}: would apply ${c.key} ${c.from} -> ${c.to}`)
    return { outcome: plan.applied.length > 0 ? 'updated' : 'unchanged', applied: plan.applied.length, held: plan.held.length }
  }

  if (plan.applied.length > 0) {
    const patch = { ...plan.patch }
    if (plan.needsGeocode) {
      const located = await geocodeVenue({
        venueName: (patch.venueName as string | undefined) ?? row.venueName,
        address: (patch.address as string | undefined) ?? row.address,
        city: (patch.city as string | undefined) ?? row.city,
        region: (patch.region as string | undefined) ?? row.region,
        country: (patch.country as string | undefined) ?? row.country,
      })
      if (located) {
        patch.latitude = located.latitude
        patch.longitude = located.longitude
      } else {
        console.warn(`[event-refresh] ${row.name}: new place did not geocode, pin left as it was`)
      }
    }

    await db.update(eventListings).set({ ...patch, updatedAt: new Date() }).where(eq(eventListings.id, row.id))
    console.log(
      `[event-refresh] ${row.name}: applied ${plan.applied.map((c) => `${c.key} ${c.from} -> ${c.to}`).join('; ')}`,
    )

    if (plan.needsRosterRefresh) await enqueueRosterRefresh(row.id)

    sendApprovalNotice({
      vertical: 'event',
      alert: true,
      title: `Event updated: ${(patch.name as string | undefined) ?? row.name}`,
      reviewUrl: `${siteUrl()}/admin/event-listings?status=published#event-${row.id}`,
      sourceUrl: (patch.website as string | undefined) ?? row.website ?? row.chiefDelphiUrl,
      facts: plan.applied.map((c) => ({ label: c.label, value: `${c.from} → ${c.to}` })),
    })
  }

  // Remember these pages only when nothing was left unproven, so a value the
  // model could not quote this week is read for again next week.
  if (!plan.held.some((h) => h.reason === 'unproven')) {
    const pages = await hashPages([...ownPages, ...read.pagesRead])
    const value: StoredHash = { hash: sourceHash(threadText, pages), pages: pages.map((p) => p.url) }
    await redis.set(key, JSON.stringify(value), 'EX', HASH_TTL_SECONDS).catch(() => {})
  }

  return { outcome: plan.applied.length > 0 ? 'updated' : 'unchanged', applied: plan.applied.length, held: plan.held.length }
}
