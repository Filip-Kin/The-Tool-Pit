/**
 * Weekly watch for an upcoming event that its own website says was called off.
 *
 * THE GAP THIS CLOSES. Nothing re-read a published event's site after it was
 * published. Blue Streaks Blitz's page said "2026 Canceled Unfortunately this
 * year's Blue Streak Blitz is Canceled." for days while the listing still said
 * confirmed, and the roster refresh then read the cleared team page as a broken
 * parser.
 *
 * CHEAP FIRST, MODEL SECOND, QUOTE ALWAYS. Every eligible listing's website (and
 * its team list page, when that is a different URL) is read, and a
 * deterministic pre-check looks for cancelled / postponed / rescheduled wording
 * outside policy context ("cancellation policy", "refund", "if the event is
 * cancelled"). Most pages miss and cost no model call. A hit goes to Sonnet with
 * the event's name and dates and a short prompt: is THIS event cancelled or
 * postponed? The answer must carry a verbatim quote, and the quote must be in
 * the page text we read, or nothing happens.
 *
 * WHAT IT DOES WITH A VERIFIED ANSWER.
 *   - cancelled: eventStatus becomes 'cancelled', unless a person claimed the
 *     field (isHumanEdited), and an alert goes to Discord so a person can
 *     revert a wrong call.
 *   - postponed: there is no such status, so only the alert.
 * Never twice for the same listing and quote: a Redis key per (listing, verdict,
 * quote) is claimed before acting, so a person who reverts a wrong cancel is
 * not overruled by next week's run reading the same sentence.
 *
 * eventStatus is a human-editable column (HUMAN_EDITABLE_EVENT_KEYS), which is
 * why the claim is checked on a fresh read of the row right before the write.
 */
import { createHash } from 'node:crypto'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { getDb, eventListings, isHumanEdited } from '@the-tool-pit/db'
import { sendApprovalNotice, siteUrl } from '@the-tool-pit/types'
import { anthropic, hasAnthropicCredentials } from '../anthropic.js'
import { delay, politeFetch } from '../connectors/base.js'
import { htmlToText, renderPage } from '../connectors/playwright-render.js'
import { fetchWithRelayFallback } from '../grants/relay-fetch.js'
import { normaliseForQuoteMatch, parseJsonObject, quoteSource } from '../model/evidence.js'
import { getRedis } from '../redis.js'

const MODEL = 'claude-sonnet-5'
/** An event that started up to this many days ago is still watched. */
export const WATCH_LOOKBACK_DAYS = 3
const MAX_PAGE_CHARS = 30_000
/** A claimed (listing, verdict, quote) is remembered this long. */
const DEDUPE_TTL_SECONDS = 400 * 86_400

// #region pre-check

/**
 * The words that can state a cancellation or a postponement. Bare "cancel" is
 * left out on purpose: it is a button label on every form and dialog
 * ("Cancel and close" on every Salesforce event page).
 */
const STATUS_WORD = /\b(cancell?ed|cancell?ation|postponed?|postponement|rescheduled?)\b/i

/**
 * A sentence with one of these in it is about a policy or a possibility, not a
 * statement that this event is off.
 */
const POLICY_CONTEXT = [
  /\bcancell?ation\s+(polic|terms|fee|deadline|request|form)/i,
  /\brefund/i,
  /\bif\s+(the|this|an|our|your|a)\b[^.!?]{0,60}\b(is|are|was|be|gets?)\s+(cancell?ed|postponed|rescheduled)/i,
  /\bin\s+(the\s+)?(case|event)\s+of\b[^.!?]{0,40}\b(cancell?ation|postponement|cancell?ed|postponed)/i,
  /\b(may|might|could|can|will)\s+be\s+(cancell?ed|postponed|rescheduled)/i,
  /\bshould\b[^.!?]{0,60}\b(cancell?ed|postponed|rescheduled)/i,
  /\b(cancell?ed|postponed|rescheduled)\s+(due\s+to\s+)?(inclement\s+)?weather\s+(polic|plan)/i,
]

/**
 * The sentences on a page that say cancelled / postponed / rescheduled outside
 * policy context. Empty means no model call. Each is cut at sentence ends and
 * line breaks, and capped, so one long paragraph is not sent as a "line".
 */
export function cancellationHits(text: string): string[] {
  const hits: string[] = []
  const seen = new Set<string>()
  const re = new RegExp(STATUS_WORD.source, 'gi')
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    const before = text.slice(Math.max(0, at - 200), at)
    const after = text.slice(at, at + 200)
    const startCut = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n'))
    const endRel = after.search(/[.!?\n]/)
    const sentence = (before.slice(startCut + 1) + (endRel === -1 ? after : after.slice(0, endRel + 1)))
      .replace(/\s+/g, ' ')
      .trim()
    if (!sentence || POLICY_CONTEXT.some((p) => p.test(sentence))) continue
    const key = sentence.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(sentence)
  }
  return hits
}

// #endregion

// #region verdict

export type WatchStatus = 'cancelled' | 'postponed' | 'none'

export interface WatchVerdict {
  status: WatchStatus
  quote: string
}

/** The model's JSON answer, or null when it is not one. */
export function parseVerdict(text: string): WatchVerdict | null {
  const raw = parseJsonObject(text)
  if (!raw) return null
  const status = raw.status
  if (status !== 'cancelled' && status !== 'postponed' && status !== 'none') return null
  const quote = typeof raw.quote === 'string' ? raw.quote.trim() : ''
  return { status, quote }
}

/**
 * A quote is evidence only when it is in the page text we read, word for word
 * (whitespace and typographic quotes folded), and itself says cancelled /
 * postponed / rescheduled. "Blue Streak Blitz" alone is in the page but proves
 * nothing.
 */
export function quoteVerified(quote: string, pageText: string): boolean {
  if (!quote || !STATUS_WORD.test(quote)) return false
  return quoteSource(quote, [{ source: 'page', text: pageText }]) === 'page'
}

/** Redis key for "this listing was already acted on for this quote". */
export function watchDedupeKey(listingId: string, status: WatchStatus, quote: string): string {
  const h = createHash('sha256').update(normaliseForQuoteMatch(quote)).digest('hex').slice(0, 16)
  return `event-status-watch:${listingId}:${status}:${h}`
}

/** Published, still tentative or confirmed, and starting no earlier than three days ago. */
export function isWatchable(
  listing: { status: string; eventStatus: string | null; startDate: string | null },
  today: string,
): boolean {
  if (listing.status !== 'published') return false
  if (listing.eventStatus !== 'tentative' && listing.eventStatus !== 'confirmed') return false
  if (!listing.startDate) return false
  return listing.startDate >= addDays(today, -WATCH_LOOKBACK_DAYS)
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

const SYSTEM_PROMPT = `You read the text of a FIRST Robotics event's web page. Decide whether the page states that THIS event, the one named with the dates given, is cancelled or postponed.

- "cancelled": the page says this event (this year's edition) is cancelled or will not run.
- "postponed": the page says this event is postponed or moved to other dates.
- "none": anything else. A cancellation or refund policy, a conditional ("if the event is cancelled"), a weather plan, a different event, or a past year's edition is "none".

Return JSON only: {"status": "cancelled" | "postponed" | "none", "quote": "<the sentence from the page that states it, copied exactly, or empty for none>"}`

async function askVerdict(
  listing: { name: string; startDate: string | null; endDate: string | null; seasonYear: number | null },
  url: string,
  text: string,
  hits: string[],
): Promise<WatchVerdict | null> {
  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            `Event: ${listing.name}`,
            `Dates: ${listing.startDate ?? '?'}${listing.endDate && listing.endDate !== listing.startDate ? ` to ${listing.endDate}` : ''}`,
            listing.seasonYear ? `Season: ${listing.seasonYear}` : '',
            `Page: ${url}`,
            '',
            'Lines that matched:',
            ...hits.slice(0, 10).map((h) => `- ${h}`),
            '',
            'Page text:',
            text.slice(0, MAX_PAGE_CHARS),
          ]
            .filter((l) => l !== '')
            .join('\n'),
        },
      ],
    })
    const block = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text',
    )
    return block ? parseVerdict(block.text) : null
  } catch (err) {
    console.error(`[event-status-watch] ${listing.name}: model call failed: ${String(err).split('\n')[0]}`)
    return null
  }
}

// #endregion

// #region reading

/**
 * A page's visible text. The browser first (Wix and Google Sites need it, and
 * it falls back to a plain fetch on its own), then the NAS relay when the
 * worker's IP was refused.
 */
async function readPageText(url: string): Promise<string | null> {
  const rendered = await renderPage(url)
  if (rendered && rendered.text.length >= 200) return rendered.text
  try {
    const out = await fetchWithRelayFallback(url, () => politeFetch(url))
    if (out.via !== 'direct' && out.res.ok) {
      const text = htmlToText(await out.res.text())
      if (text.length > (rendered?.text.length ?? 0)) return text
    }
  } catch {
    // Neither path read it; the browser's short text, if any, is all there is.
  }
  return rendered?.text ?? null
}

// #endregion

export interface EventStatusWatchStats {
  considered: number
  /** Listings with at least one page that passed the pre-check. */
  flagged: number
  cancelled: number
  postponed: number
  failed: number
}

export async function processEventStatusWatch(): Promise<EventStatusWatchStats> {
  const stats: EventStatusWatchStats = { considered: 0, flagged: 0, cancelled: 0, postponed: 0, failed: 0 }
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      status: eventListings.status,
      eventStatus: eventListings.eventStatus,
      startDate: eventListings.startDate,
      endDate: eventListings.endDate,
      seasonYear: eventListings.seasonYear,
      website: eventListings.website,
      teamListUrl: eventListings.teamListUrl,
    })
    .from(eventListings)
    .where(
      and(
        eq(eventListings.status, 'published'),
        inArray(eventListings.eventStatus, ['tentative', 'confirmed']),
        gte(eventListings.startDate, addDays(today, -WATCH_LOOKBACK_DAYS)),
      ),
    )

  const listings = rows.filter((l) => isWatchable(l, today) && (l.website || l.teamListUrl))
  stats.considered = listings.length
  const canAsk = hasAnthropicCredentials()

  for (const listing of listings) {
    const urls = [...new Set([listing.website, listing.teamListUrl].filter((u): u is string => Boolean(u)))]
    let flagged = false
    try {
      for (const url of urls) {
        const text = await readPageText(url)
        if (!text) continue
        const hits = cancellationHits(text)
        if (hits.length === 0) continue
        if (!flagged) stats.flagged++
        flagged = true
        console.log(`[event-status-watch] ${listing.name}: ${hits.length} line(s) on ${url}: ${hits[0].slice(0, 120)}`)
        if (!canAsk) continue

        const verdict = await askVerdict(listing, url, text, hits)
        if (!verdict || verdict.status === 'none') continue
        if (!quoteVerified(verdict.quote, text)) {
          console.warn(`[event-status-watch] ${listing.name}: "${verdict.status}" quote not on the page, ignored: ${verdict.quote.slice(0, 120)}`)
          continue
        }
        const acted = await actOnVerdict(listing, url, verdict)
        if (acted === 'cancelled') stats.cancelled++
        if (acted === 'postponed') stats.postponed++
        break
      }
    } catch (err) {
      stats.failed++
      console.error(`[event-status-watch] ${listing.name}: ${String(err)}`)
    }
    await delay(500)
  }

  console.log(
    `[event-status-watch] ${stats.considered} listings: ${stats.flagged} flagged by the pre-check, ` +
      `${stats.cancelled} cancelled, ${stats.postponed} postponed, ${stats.failed} failed`,
  )
  return stats
}

/** Apply one verified verdict, at most once per (listing, verdict, quote). */
async function actOnVerdict(
  listing: { id: string; name: string },
  url: string,
  verdict: WatchVerdict,
): Promise<WatchStatus | null> {
  const db = getDb()
  // Fresh read right before the write: the status or the claim may have moved
  // since the select at the top of the run.
  const [row] = await db
    .select({ eventStatus: eventListings.eventStatus, humanEditedFields: eventListings.humanEditedFields })
    .from(eventListings)
    .where(eq(eventListings.id, listing.id))
    .limit(1)
  if (!row || row.eventStatus === 'cancelled') return null

  const key = watchDedupeKey(listing.id, verdict.status, verdict.quote)
  const claimed = await getRedis().set(key, new Date().toISOString(), 'EX', DEDUPE_TTL_SECONDS, 'NX')
  if (!claimed) {
    console.log(`[event-status-watch] ${listing.name}: "${verdict.status}" already acted on for this quote`)
    return null
  }

  const reviewUrl = `${siteUrl()}/admin/event-listings?status=published#event-${listing.id}`

  if (verdict.status === 'cancelled') {
    const claimedByHuman = isHumanEdited(row.humanEditedFields, 'eventStatus')
    if (!claimedByHuman) {
      try {
        await db
          .update(eventListings)
          .set({ eventStatus: 'cancelled', updatedAt: new Date() })
          .where(and(eq(eventListings.id, listing.id), inArray(eventListings.eventStatus, ['tentative', 'confirmed'])))
      } catch (err) {
        // Let next week's run try again.
        await getRedis().del(key).catch(() => {})
        throw err
      }
    }
    console.log(
      `[event-status-watch] ${listing.name}: CANCELLED per ${url}${claimedByHuman ? ' (eventStatus is human-claimed, left as is)' : ''}: ${verdict.quote}`,
    )
    sendApprovalNotice({
      vertical: 'event',
      alert: true,
      title: `Event cancelled: ${listing.name}`,
      reviewUrl,
      sourceUrl: url,
      facts: [
        { label: 'Quote', value: verdict.quote },
        { label: 'Page', value: url },
        { label: 'Status', value: claimedByHuman ? 'Unchanged, human edit' : 'Set to cancelled', inline: true },
      ],
    })
    return 'cancelled'
  }

  console.log(`[event-status-watch] ${listing.name}: POSTPONED per ${url}: ${verdict.quote}`)
  sendApprovalNotice({
    vertical: 'event',
    alert: true,
    title: `Event postponed: ${listing.name}`,
    reviewUrl,
    sourceUrl: url,
    facts: [
      { label: 'Quote', value: verdict.quote },
      { label: 'Page', value: url },
      { label: 'Status', value: 'Unchanged', inline: true },
    ],
  })
  return 'postponed'
}
