/**
 * Flickr album connector.
 * Scrapes a curated list of FIRST-photographer Flickr accounts for their album
 * (photoset) list, plus a few directly-provided album URLs. Album titles are not
 * in the list HTML, but each album page server-renders an og:title (e.g.
 * "2026 FRC FIN State Championship Event"), so the enrich step OG-scrapes each
 * album URL and matches it to an event by title + year.
 */
import { politeFetch, delay } from './base.js'
import {
  type AlbumConnector,
  type AlbumConnectorResult,
  type AlbumCandidateInput,
} from './album-hosts.js'

const FLICKR = 'https://www.flickr.com'

/** Flickr accounts (usernames or NSIDs) to scrape every run. */
const FLICKR_ACCOUNTS = [
  '204345103@N03',
  'firstcanada',
  'indianafirst',
  'illinoisfirst',
  '145772283@N05',
  'firstroboticsnl',
  'rfq',
  '146244579@N06',
  'danielernst',
  'indianaroboticsinvitational',
]

/** Individual album/set URLs provided directly (not tied to a scraped account list). */
const FLICKR_DIRECT_ALBUMS = [
  'https://www.flickr.com/photos/146244579@N06/albums/72177720332918875',
  'https://www.flickr.com/photos/143447923@N02/sets/72177720333045862',
  'https://www.flickr.com/photos/146244579@N06/albums/72177720324659916',
  'https://www.flickr.com/photos/146244579@N06/albums/72177720324278987',
  'https://www.flickr.com/photos/146244579@N06/albums/72177720324927064',
]

const MAX_PAGES = 15
/** Flickr photoset (album) ids are long numbers; preceded by "albums/" or "id":". */
const ALBUM_ID_RE = /(?:albums\/|"id":")(\d{16,})/g

export class FlickrAlbumsConnector implements AlbumConnector {
  name = 'flickr_albums'

  async run(): Promise<AlbumConnectorResult> {
    const candidates: AlbumCandidateInput[] = []
    const errors: string[] = []
    const seen = new Set<string>()

    const push = (canonicalUrl: string, sourceUrl: string) => {
      if (seen.has(canonicalUrl)) return
      seen.add(canonicalUrl)
      candidates.push({ sourceUrl, canonicalUrl, provider: 'flickr' })
    }

    // Direct albums first.
    for (const url of FLICKR_DIRECT_ALBUMS) {
      push(url.replace(/\/$/, ''), url)
    }

    // Scrape each account's paginated album list.
    for (const account of FLICKR_ACCOUNTS) {
      const listBase = `${FLICKR}/photos/${account}/albums`
      const accountIds = new Set<string>()
      try {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const res = await politeFetch(`${listBase}${page > 1 ? `?page=${page}` : ''}`)
          if (!res.ok) {
            if (res.status !== 404) errors.push(`[flickr] HTTP ${res.status} for ${account} p${page}`)
            break
          }
          const html = await res.text()
          const before = accountIds.size
          for (const m of html.matchAll(ALBUM_ID_RE)) accountIds.add(m[1])
          // Stop when a page adds no new album ids (past the last page).
          if (accountIds.size === before) break
          await delay(1200)
        }
      } catch (err) {
        errors.push(`[flickr] error scraping ${account}: ${String(err)}`)
      }
      for (const id of accountIds) {
        push(`${FLICKR}/photos/${account}/albums/${id}`, listBase)
      }
      console.log(`[flickr] ${account}: ${accountIds.size} albums`)
    }

    console.log(`[flickr] done - ${candidates.length} album candidates`)
    return { candidates, stats: { discovered: candidates.length, skipped: 0, errors } }
  }
}
