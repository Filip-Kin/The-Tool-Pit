/**
 * The two checks every grant gets, on the way in and on cadence after:
 * where "Apply" lands, and what the funder says about timing. One module so
 * the extraction job (candidates) and the monitor (published grants) cannot
 * drift apart in what they consider verified.
 *
 * Dates are the fact a team needs most, and funders keep them one click
 * away: a "Deadlines" page, a "How to apply" page, a guidelines PDF, a page
 * that refuses a plain fetch. So the timing check reads the info page, the
 * apply chain, the PDFs among them, and one hop to any link whose words say
 * dates, and it renders in a browser what a plain fetch is refused.
 */
import { politeFetch } from '../connectors/base.js'
import { stripToMainContent } from './strip.js'
import { resolveApplyRoute, renderedHtml, type ApplyRoute } from './apply-route.js'
import { findDeadlineProof, type DeadlineProof } from './deadline-proof.js'
import { archiveCopy } from './archive.js'

const TEXT_LIMIT = 20_000
const DATE_LINK_RE = /(deadline|dates?\b|timeline|calendar|schedule|how to apply|apply\b|application|guidelines?|faq|eligib|cycle|round|program details|grant details|request for proposals|rfp)/i
const MAX_HOPS = 4

interface ReadPage {
  text: string
  html: string | null
  /** Set when the words came from the Wayback Machine, so the proof says so. */
  archiveUrl?: string
}

async function readPage(url: string): Promise<ReadPage> {
  try {
    const res = await politeFetch(url)
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      // A bot wall is not an empty page; the browser reads it.
      if ([401, 403, 406, 429, 503].includes(res.status)) {
        const html = await renderedHtml(url).catch(() => null)
        if (html) return { text: stripToMainContent(html).slice(0, TEXT_LIMIT), html }
        // A wall the browser cannot pass either: read the public archive copy.
        const copy = await archiveCopy(url)
        if (copy) return { text: stripToMainContent(copy.html).slice(0, TEXT_LIMIT), html: copy.html, archiveUrl: copy.url }
      }
      return { text: '', html: null }
    }
    if (/pdf/i.test(ct) || /\.pdf(\?|#|$)/i.test(url)) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === '%PDF') {
        const { extractText } = await import('unpdf')
        const { text } = await extractText(bytes, { mergePages: true })
        return { text: (text ?? '').replace(/\s+/g, ' ').slice(0, TEXT_LIMIT), html: null }
      }
      return { text: '', html: null }
    }
    if (!/html|xhtml/i.test(ct)) return { text: '', html: null }
    const html = await res.text()
    let text = stripToMainContent(html).slice(0, TEXT_LIMIT)
    if (!text.trim()) {
      // JS-only page: render it before calling it empty.
      const rendered = await renderedHtml(url).catch(() => null)
      if (rendered) {
        text = stripToMainContent(rendered).slice(0, TEXT_LIMIT)
        return { text, html: rendered }
      }
    }
    return { text, html }
  } catch {
    return { text: '', html: null }
  }
}

/** Same-site links whose words say "dates live here", best first. */
export function dateLinks(html: string, pageUrl: string): string[] {
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }
  const out: Array<{ url: string; score: number }> = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL
    try {
      u = new URL(m[1], base)
    } catch {
      continue
    }
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue
    if (/^(mailto|tel|javascript):/i.test(m[1])) continue
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const hay = `${text} ${u.pathname}`
    if (!DATE_LINK_RE.test(hay)) continue
    const href = u.toString().replace(/\/$/, '')
    if (href === pageUrl.replace(/\/$/, '') || seen.has(href)) continue
    seen.add(href)
    let score = 0
    if (/(deadline|dates?\b|timeline|calendar|schedule)/i.test(hay)) score += 3
    if (/(how to apply|apply\b|application|guidelines?|rfp|request for proposals)/i.test(hay)) score += 2
    if (/(faq|eligib|cycle|round|details)/i.test(hay)) score += 1
    if (/\.pdf(\?|$)/i.test(u.pathname)) score += 1
    out.push({ url: href, score })
  }
  return out.sort((a, b) => b.score - a.score).map((o) => o.url)
}

export interface ListingVerification {
  route: ApplyRoute
  proof: DeadlineProof & { past?: { date: string; quote: string; url: string } }
}

/**
 * `startUrls` are tried in order for the route (current application link
 * first, then the info page). `knownTexts` are pages already read by the
 * caller, so they are not fetched twice; every other page on the route's
 * chain is read once for the timing check, plus one hop to the pages that
 * say dates when the pages so far said nothing dated.
 */
export async function verifyListing(
  startUrls: Array<string | null | undefined>,
  knownTexts: Array<{ url: string; text: string }> = [],
): Promise<ListingVerification> {
  const route = await resolveApplyRoute(startUrls)
  const pages = [...knownTexts]
  const have = new Set(pages.map((p) => p.url))
  const wanted = [...startUrls.filter((u): u is string => Boolean(u)), ...route.chain].filter((u, i, all) => all.indexOf(u) === i)
  const hops: string[] = []
  for (const url of wanted) {
    if (have.has(url)) continue
    const page = await readPage(url)
    if (page.text.trim()) pages.push({ url: page.archiveUrl ?? url, text: page.text })
    if (page.html) for (const l of dateLinks(page.html, url)) if (!have.has(l) && !hops.includes(l)) hops.push(l)
    have.add(url)
  }
  let proof = findDeadlineProof(pages)
  if (proof.kind !== 'dated' && hops.length > 0) {
    for (const url of hops.slice(0, MAX_HOPS)) {
      const page = await readPage(url)
      if (page.text.trim()) pages.push({ url: page.archiveUrl ?? url, text: page.text })
      have.add(url)
    }
    proof = findDeadlineProof(pages)
  }
  return { route, proof }
}
