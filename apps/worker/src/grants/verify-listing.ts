/**
 * The two checks every grant gets, on the way in and on cadence after:
 * where "Apply" lands, and what the funder says about timing. One module so
 * the extraction job (candidates) and the monitor (published grants) cannot
 * drift apart in what they consider verified.
 */
import { politeFetch } from '../connectors/base.js'
import { stripToMainContent } from './strip.js'
import { resolveApplyRoute, type ApplyRoute } from './apply-route.js'
import { findDeadlineProof, type DeadlineProof } from './deadline-proof.js'

const TEXT_LIMIT = 20_000

async function pageText(url: string): Promise<string> {
  try {
    const res = await politeFetch(url)
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok || !/html|xhtml/i.test(ct)) return ''
    return stripToMainContent(await res.text()).slice(0, TEXT_LIMIT)
  } catch {
    return ''
  }
}

export interface ListingVerification {
  route: ApplyRoute
  proof: DeadlineProof & { past?: { date: string; quote: string; url: string } }
}

/**
 * `startUrls` are tried in order for the route (current application link
 * first, then the info page). `knownTexts` are pages already read by the
 * caller, so they are not fetched twice; every other page on the route's
 * chain is read once for the timing check.
 */
export async function verifyListing(
  startUrls: Array<string | null | undefined>,
  knownTexts: Array<{ url: string; text: string }> = [],
): Promise<ListingVerification> {
  const route = await resolveApplyRoute(startUrls)
  const pages = [...knownTexts]
  const have = new Set(pages.map((p) => p.url))
  const wanted = [...startUrls.filter((u): u is string => Boolean(u)), ...route.chain].filter((u, i, all) => all.indexOf(u) === i)
  for (const url of wanted) {
    if (have.has(url)) continue
    const text = await pageText(url)
    if (text.trim()) pages.push({ url, text })
    have.add(url)
  }
  const proof = findDeadlineProof(pages)
  return { route, proof }
}
