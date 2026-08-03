/**
 * First in Michigan album connector.
 * FiM publishes a structured event list at /FRC/events/ where each event links
 * to /FRC/<code>/ (the code matches the TBA event_code). Each event page carries
 * "EVENT PHOTOS" / "EVENT PHOTOS 1/2/3" anchors pointing at album hosts. This is
 * a direct event-code → album-URL mapping - the highest-signal source.
 */
import { parse } from 'node-html-parser'
import { politeFetch, delay } from './base.js'
import {
  type AlbumConnector,
  type AlbumConnectorResult,
  type AlbumCandidateInput,
  canonicalizeAlbumUrl,
} from './album-hosts.js'

const FIM_BASE = 'https://firstinmichigan.us'
const FIM_HOST = 'firstinmichigan.us'
const EVENTS_URL = `${FIM_BASE}/FRC/events/`

/** Event links look like /FRC/<code>/ (hrefs on the page are absolute). */
const EVENT_PATH_RE = /^\/FRC\/([a-z0-9-]+)\/?$/i
/** /FRC/<slug>/ pages that are site nav, not events. */
const NON_EVENT_SLUGS = new Set([
  'feed', 'wp-json', 'events', 'about', 'get-involved', 'run-a-team', 'sponsor',
  'volunteer', 'grants', 'resources', 'virtual-robotics-studio', 'contact',
  'webcasts', 'news', 'calendar', 'home', 'search', 'donate',
])
/** Photo anchors: "EVENT PHOTOS", "EVENT PHOTOS 1", ... */
const PHOTO_TEXT_RE = /^EVENT PHOTOS(\s*\d+)?$/i

export class FimAlbumsConnector implements AlbumConnector {
  name = 'fim_albums'

  async run(year: number): Promise<AlbumConnectorResult> {
    const candidates: AlbumCandidateInput[] = []
    const errors: string[] = []
    let skipped = 0

    // 1. Fetch the events list and collect event codes.
    let codes: string[] = []
    try {
      const res = await politeFetch(EVENTS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${EVENTS_URL}`)
      const root = parse(await res.text())
      const seen = new Set<string>()
      for (const a of root.querySelectorAll('a')) {
        const href = a.getAttribute('href')
        if (!href) continue
        let path: string
        let host: string
        try {
          const u = new URL(href, FIM_BASE)
          path = u.pathname
          host = u.hostname.toLowerCase()
        } catch {
          continue
        }
        if (host !== FIM_HOST) continue
        const m = path.match(EVENT_PATH_RE)
        if (!m) continue
        const code = m[1].toLowerCase()
        if (NON_EVENT_SLUGS.has(code)) continue
        if (!seen.has(code)) {
          seen.add(code)
          codes.push(code)
        }
      }
    } catch (err) {
      errors.push(`[fim-albums] ${String(err)}`)
      console.error('[fim-albums] failed to load events list:', err)
      return { candidates, stats: { discovered: 0, skipped: 0, errors } }
    }

    console.log(`[fim-albums] ${codes.length} event codes from FiM events list`)

    // 2. For each event page, extract EVENT PHOTOS anchors.
    for (const code of codes) {
      const eventPage = `${FIM_BASE}/FRC/${code}/`
      try {
        await delay(1000)
        const res = await politeFetch(eventPage)
        if (!res.ok) {
          if (res.status !== 404) errors.push(`[fim-albums] HTTP ${res.status} for ${code}`)
          continue
        }
        const root = parse(await res.text())
        const seenUrls = new Set<string>()
        let eventTitle: string | undefined
        const h1 = root.querySelector('h1')
        if (h1) eventTitle = h1.innerText.trim() || undefined

        for (const a of root.querySelectorAll('a')) {
          const text = a.innerText.trim()
          if (!PHOTO_TEXT_RE.test(text)) continue
          const href = a.getAttribute('href')
          if (!href) continue
          const canon = canonicalizeAlbumUrl(href, { allowUnknown: true })
          if (!canon) {
            skipped++
            continue
          }
          if (seenUrls.has(canon.canonicalUrl)) continue
          seenUrls.add(canon.canonicalUrl)

          candidates.push({
            sourceUrl: eventPage,
            canonicalUrl: canon.canonicalUrl,
            provider: canon.provider,
            targetEventCode: code,
            targetEventYear: year,
            rawMetadata: {
              title: text,
              threadUrl: eventPage,
              threadTitle: eventTitle,
            },
          })
        }
      } catch (err) {
        errors.push(`[fim-albums] error on ${code}: ${String(err)}`)
      }
    }

    console.log(`[fim-albums] done - ${candidates.length} album candidates, ${skipped} skipped`)
    return { candidates, stats: { discovered: candidates.length, skipped, errors } }
  }
}
