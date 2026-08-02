/**
 * Chief Delphi album connector.
 * Reuses the Discourse search mechanics from chief-delphi.ts, but tuned to find
 * photo-album links (SmugMug/Flickr/Google Photos/Pixieset) and attach a target
 * FRC event to each. Runtime queries are built from the season's events so we
 * search for "<event name> photos" in addition to generic media queries.
 *
 * The event match here is a heuristic that only sets targetEventCode; the enrich
 * job resolves it to a real event (or defers to AI / admin) before publish.
 */
import { eq } from 'drizzle-orm'
import { getDb, events } from '@the-tool-pit/db'
import { politeFetch, delay } from './base.js'
import {
  type AlbumConnector,
  type AlbumConnectorResult,
  type AlbumCandidateInput,
  canonicalizeAlbumUrl,
} from './album-hosts.js'

const BASE = 'https://www.chiefdelphi.com'

/** Generic media-oriented searches, always run. */
const BASE_QUERIES = [
  'event photos category:media',
  'smugmug frc',
  'flickr frc event',
  'pixieset frc',
  'photos.google.com frc',
  'event photos album',
]

/** Max per-event name queries to run (keeps the crawl polite/bounded). */
const MAX_EVENT_QUERIES = 40

const URL_RE = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(?:\/[^\s"<>)'[\]]*)?/g

interface EventLite {
  eventCode: string
  name: string
}

/** Strip generic event-name noise so name matching keys on the distinctive part. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/presented by.*$/i, '')
    .replace(/\b(district|event|competition|regional|frc|first|robotics|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface DiscourseSearchTopic {
  id: number
  title: string
  slug: string
  like_count: number
  blurb: string
}
interface DiscourseSearchResult {
  topics?: DiscourseSearchTopic[]
  posts?: Array<{ blurb: string; topic_id: number; like_count: number }>
}
interface DiscourseTopicDetail {
  post_stream?: { posts?: Array<{ cooked?: string; raw?: string }> }
}

export class ChiefDelphiAlbumsConnector implements AlbumConnector {
  name = 'chief_delphi_albums'

  async run(year: number): Promise<AlbumConnectorResult> {
    const candidates: AlbumCandidateInput[] = []
    const errors: string[] = []
    let skipped = 0

    // Load the season's events for query building + code/name matching.
    const db = getDb()
    const rows = (await db
      .select({ eventCode: events.eventCode, name: events.name })
      .from(events)
      .where(eq(events.year, year))) as EventLite[]

    const codeSet = new Set(rows.map((r) => r.eventCode))
    const nameKeys = rows
      .map((r) => ({ code: r.eventCode, key: nameKey(r.name) }))
      .filter((r) => r.key.length >= 4)

    const eventQueries = rows.slice(0, MAX_EVENT_QUERIES).map((r) => `${r.name} photos`)
    const queries = [...BASE_QUERIES, ...eventQueries]

    const seenUrls = new Set<string>()
    const seenTopics = new Set<number>()

    for (const query of queries) {
      try {
        const res = await politeFetch(`${BASE}/search.json?q=${encodeURIComponent(query)}&page=1`)
        if (!res.ok) {
          errors.push(`[cd-albums] HTTP ${res.status} for "${query}"`)
          await delay(3000)
          continue
        }
        const data = (await res.json()) as DiscourseSearchResult
        const topics = data.topics ?? []
        const likesMap = new Map<number, number>()
        for (const p of data.posts ?? []) if (!likesMap.has(p.topic_id)) likesMap.set(p.topic_id, p.like_count)

        for (const topic of topics) {
          if (seenTopics.has(topic.id)) continue
          seenTopics.add(topic.id)

          const threadUrl = `${BASE}/t/${topic.slug}/${topic.id}`
          let albumUrls = this.extractAlbumUrls(topic.blurb ?? '')

          if (albumUrls.length === 0) {
            try {
              await delay(1000)
              const tRes = await politeFetch(`${BASE}/t/${topic.id}.json`)
              if (tRes.ok) {
                const tData = (await tRes.json()) as DiscourseTopicDetail
                const first = tData.post_stream?.posts?.[0]
                albumUrls = this.extractAlbumUrls((first?.cooked ?? '') + ' ' + (first?.raw ?? ''))
              }
            } catch {
              // skip
            }
          }
          if (albumUrls.length === 0) continue

          const match = this.matchEvent(topic.title ?? '', topic.blurb ?? '', codeSet, nameKeys)

          for (const { canonicalUrl, provider } of albumUrls) {
            if (seenUrls.has(canonicalUrl)) continue
            seenUrls.add(canonicalUrl)
            candidates.push({
              sourceUrl: threadUrl,
              canonicalUrl,
              provider,
              targetEventCode: match ?? undefined,
              targetEventYear: year,
              rawMetadata: {
                threadUrl,
                threadTitle: topic.title || undefined,
                blurb: topic.blurb || undefined,
              },
            })
          }
        }
      } catch (err) {
        errors.push(`[cd-albums] error for "${query}": ${String(err)}`)
      }
      await delay(1500)
    }

    console.log(`[cd-albums] done — ${candidates.length} album candidates, ${skipped} skipped`)
    return { candidates, stats: { discovered: candidates.length, skipped, errors } }
  }

  private extractAlbumUrls(text: string): Array<{ canonicalUrl: string; provider: AlbumCandidateInput['provider'] }> {
    const raw = text.match(URL_RE) ?? []
    const out: Array<{ canonicalUrl: string; provider: AlbumCandidateInput['provider'] }> = []
    const seen = new Set<string>()
    for (const u of raw) {
      const canon = canonicalizeAlbumUrl(u) // known album hosts only
      if (canon && !seen.has(canon.canonicalUrl)) {
        seen.add(canon.canonicalUrl)
        out.push(canon)
      }
    }
    return out
  }

  /** Heuristic: exact event-code token first, then distinctive name containment. */
  private matchEvent(
    title: string,
    blurb: string,
    codeSet: Set<string>,
    nameKeys: Array<{ code: string; key: string }>,
  ): string | null {
    const haystack = `${title} ${blurb}`.toLowerCase()
    for (const token of haystack.split(/[^a-z0-9]+/)) {
      if (token.length >= 4 && codeSet.has(token)) return token
    }
    const titleKey = ` ${nameKey(title)} `
    let best: { code: string; len: number } | null = null
    for (const { code, key } of nameKeys) {
      if (titleKey.includes(` ${key} `) && (!best || key.length > best.len)) {
        best = { code, len: key.length }
      }
    }
    return best?.code ?? null
  }
}
