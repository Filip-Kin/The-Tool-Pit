/**
 * The programme page for a grant whose only known URL is the entrance.
 *
 * A sheet row or a crawl hit often carries the portal login (aauw.fluxx.io,
 * a CyberGrants quiz) and nothing else. Read that and the listing has no
 * award, no dates and a summary about a login form. The funder's own page
 * is one search away: "<funder> <programme>" on the funder's domain. One
 * Brave query per candidate, the budget guard is brave.ts's.
 */
import { isEntranceUrl } from '@the-tool-pit/db/grant-urls'
import { braveSearch } from './brave.js'
import { SECONDHAND_HOSTS } from './prefilter.js'

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/** Places that write ABOUT grants and never hold the programme page. */
const NOT_FUNDER_HOSTS = /(^|\.)(facebook\.com|linkedin\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|wikipedia\.org|reddit\.com|chiefdelphi\.com|guidestar\.org|candid\.org|propublica\.org|causeiq\.com|charitynavigator\.org|instrumentl\.com|grantstation\.com|grantwatch\.com|opengrants\.io|zoominfo\.com|crunchbase\.com|glassdoor\.com|indeed\.com)$/i

const STOP = new Set(['the', 'and', 'of', 'for', 'foundation', 'fund', 'inc', 'llc', 'company', 'corporation', 'corp', 'co', 'grant', 'grants', 'program', 'programme', 'application', 'community', 'charitable', 'trust'])

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export interface InfoPage {
  url: string
  title: string
  /** Why this page and not another: the words that matched. */
  evidence: string
}

export function scoreInfoResult(r: { url: string; title: string; description: string }, funderName: string, grantName: string): number {
  const host = hostOf(r.url)
  if (!host || isEntranceUrl(r.url) || NOT_FUNDER_HOSTS.test(host)) return 0
  if (SECONDHAND_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 0
  // A homepage is not a programme page (murdocktrust.org/ was picked once),
  // and FIRST's own round-up of team grants is a list, not the funder.
  let path = ''
  try {
    path = new URL(r.url).pathname.replace(/\/$/, '')
  } catch {
    return 0
  }
  if (path === '' || /^\/(en|en-us|us|home|index\.html?)$/i.test(path)) return 0
  if (/(^|\.)firstinspires\.org$/i.test(host) && !/firstinspires\.org$/i.test(hostOf(`https://${funderName.toLowerCase().replace(/\s+/g, '')}.org`))) return 0
  const funderWords = words(funderName)
  const nameWords = words(grantName)
  const hostBare = host.replace(/\./g, '')
  let score = 0
  if (funderWords.some((w) => w.length >= 4 && hostBare.includes(w))) score += 3
  const text = `${r.title} ${r.description}`.toLowerCase()
  const nameHits = nameWords.filter((w) => text.includes(w)).length
  if (nameWords.length > 0 && nameHits >= Math.min(2, nameWords.length)) score += 2
  if (funderWords.some((w) => text.includes(w))) score += 1
  if (/\b(grant|fund|sponsor|giving|apply|application|eligib|deadline)/i.test(text)) score += 1
  if (/(grant|fund|giving|sponsor|donat|apply|program|scholar|communit|csr|social)/i.test(path)) score += 1
  return score
}

async function pageMentions(url: string, funderName: string, grantName: string): Promise<boolean | null> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, redirect: 'follow', signal: controller.signal })
    if (!res.ok) return null
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').toLowerCase()
    // The page has to name BOTH the funder and the programme: "ptc" alone
    // matched a different organisation's site (ptc.org for PTC's FIRST grant).
    const funderWords = words(funderName).slice(0, 3)
    const nameWords = words(grantName).slice(0, 4)
    const funderHit = funderWords.length === 0 || funderWords.some((w) => text.includes(w))
    const nameHit = nameWords.length === 0 || nameWords.some((w) => text.includes(w))
    return funderHit && nameHit
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * The funder's programme page, or null when the search has no page that is
 * plainly the funder's. Null is the honest answer: a wrong info link is
 * worse than a portal link, because a reader trusts it.
 */
export async function findInfoPage(funderName: string, grantName: string, avoid: string[] = []): Promise<InfoPage | null> {
  const funder = funderName.trim()
  const name = grantName.trim()
  if (!funder && !name) return null
  const results = await braveSearch(`${funder} ${name}`.trim(), { count: 8 })
  const avoidSet = new Set(avoid.map((u) => u.replace(/\/$/, '')))
  const ranked = results
    .filter((r) => !avoidSet.has(r.url.replace(/\/$/, '')))
    .map((r) => ({ r, score: scoreInfoResult(r, funder, name) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score)
  for (const { r, score } of ranked.slice(0, 3)) {
    const mentions = await pageMentions(r.url, funder, name)
    // A page that refuses a bot but sits on the funder's own domain still
    // counts; a page we could read and that never names the programme does not.
    if (mentions === false) continue
    // Unreadable (a bot wall) is accepted only on the funder's own domain
    // with the programme named in the result itself.
    if (mentions === null && score < 6) continue
    return { url: r.url, title: r.title, evidence: `search result on ${hostOf(r.url)} scored ${score}: "${r.title.slice(0, 80)}"` }
  }
  return null
}
