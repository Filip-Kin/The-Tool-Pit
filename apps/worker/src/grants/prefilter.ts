/**
 * Deterministic pre-filter: does this page even LOOK like one grant a team can
 * apply for? Runs before any model call, on the free-fetched page text.
 *
 * WHY. The aggregator crawler files thousands of links per run, and sending
 * each one to the classifier is ~$0.01 a page: $40 a day to be told, mostly,
 * "no". The junk gate catches bot walls and empty shells and the shape gate
 * catches indexes and press offices, but neither asks the basic question of
 * whether the page talks about applying for money at all. This does, with no
 * model, and everything it rejects is written with a reason and is reversible
 * from the admin.
 *
 * THREE REJECTIONS, one requirement:
 *   1. Secondhand grant databases (GrantWatch, Instrumentl, GrantedAI, ...).
 *      They describe real grants, but the page is not the funder's and cannot
 *      take an application; listing it would point teams at a paywall. The
 *      funder's own page is a separate candidate when the crawl finds it.
 *   2. Index and archive URL shapes: /category/, /tag/, /page/N, ?page=,
 *      /search, /archive. A list, not a listing.
 *   3. Non-grant page shapes: a login, a cart, a job posting, a privacy page.
 *   Requirement: the text must carry at least two of the signals every real
 *   grant page has - money words, an application route, eligibility, a
 *   deadline - and one of them must be the money word. A page about a
 *   programme that never mentions applying is a description, not a grant.
 *
 * Pure. Unit-testable without a fetch or a database.
 */

export interface PrefilterInput {
  url: string
  title: string
  /** Stripped page text. Empty when the page could not be read. */
  body: string
  /** rawMetadata.discoveredVia, so an unread page from a high-volume angle can be treated more strictly. */
  discoveredVia?: string | null
}

export interface PrefilterVerdict {
  keep: boolean
  /** Written to rejectionReason when keep is false. */
  reason?: string
}

/** Commercial or catalogue grant databases: secondhand, often paywalled, never the place to apply. */
const SECONDHAND_HOSTS = [
  'grantwatch.com',
  'instrumentl.com',
  'grantedai.com',
  'grantsoffice.com',
  'thegrantportal.com',
  'grantstation.com',
  'candid.org',
  'foundationdirectory.org',
  'fundsnetservices.com',
  'grantforward.com',
  'pivot.proquest.com',
  'grantselect.com',
  'opengrants.io',
  'grantsalert.com',
  'getgrants.com',
  'grantgopher.com',
  'grantexec.com',
  'fundsforngos.org',
  'grantwriterteam.com',
  'philanthropynewsdigest.org',
  'tgci.com',
  'grantsights.com',
  'grantsmarts.com',
  'grantreadyky.org',
  'linkprotect.cudasvc.com',
]

/**
 * Application portals. The funder sends applicants here to log in and submit;
 * the page itself never describes the grant, so as a candidate it is a login
 * screen. (apply-links.ts still follows these as the way IN from a real page.)
 */
const PORTAL_HOSTS = ['grantinterface.com', 'submittable.com', 'fluxx.io', 'smartsimple.com', 'foundant.com', 'grantrequest.com', 'cybergrants.com']

const INDEX_PATH_RE = /\/(category|categories|tag|tags|tagged|topic|topics|archive|archives|search|page\/\d+|author|feed|rss|sitemap)(\/|$)/i
const INDEX_QUERY_RE = /[?&](page|paged|p|s|q|search|tag|cat|category)=/i
const NOT_GRANT_PATH_RE = /\/(login|signin|sign-in|register|account|cart|checkout|privacy|terms|cookie|careers?|jobs?|job-openings|press-releases?|press-room|newsroom|media-kit|giving|give|donate|donations?|training|courses?|webinars?|workshops?|open-a-fund|types-of-funds)(\/|$|\.)/i

const MONEY_RE = /\b(grants?|scholarships?|fellowships?|stipends?|mini-?grants?|funding opportunit(y|ies)|financial (aid|support|assistance)|award(s| amount| program)?)\b/i
const APPLY_RE = /\b(apply|application|applications|applicants?|submit (a |an |your )?(proposal|application|request)|request for proposals?|rfp|nominate|nomination)\b/i
const ELIGIBILITY_RE = /\b(eligib(le|ility)|who (can|may) apply|qualif(y|ications?|ied)|requirements?|criteria|open to|must be)\b/i
const DEADLINE_RE = /\b(deadline|due (date|by)|applications? (are |is )?(due|close|closes|open)|closes? on|opens? on|accepting applications|rolling basis|cycle)\b/i

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function isSecondhandGrantHost(url: string): boolean {
  const host = hostOf(url)
  return SECONDHAND_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

export function deterministicGrantPrefilter(input: PrefilterInput): PrefilterVerdict {
  const { url, title } = input
  const body = input.body ?? ''

  const portalHost = hostOf(url)
  if (PORTAL_HOSTS.some((h) => portalHost === h || portalHost.endsWith(`.${h}`))) {
    return { keep: false, reason: `Prefilter: ${portalHost} is an application portal (a login screen), not a grant listing.` }
  }
  if (isSecondhandGrantHost(url)) {
    return {
      keep: false,
      reason: `Prefilter: ${hostOf(url)} is a grant database, not the funder. It describes the grant secondhand and cannot take an application; the funder's own page is the listing.`,
    }
  }

  let path = ''
  let search = ''
  try {
    const u = new URL(url)
    path = u.pathname.toLowerCase()
    search = u.search
  } catch {
    return { keep: false, reason: 'Prefilter: not a URL' }
  }

  if (INDEX_PATH_RE.test(path) || INDEX_QUERY_RE.test(search)) {
    return { keep: false, reason: `Prefilter: the URL is an index or archive page (${path}${search}), a list rather than one grant.` }
  }
  if (NOT_GRANT_PATH_RE.test(path)) {
    return { keep: false, reason: `Prefilter: the URL path is site furniture (${path}), not a grant page.` }
  }

  const fromAggregator = (input.discoveredVia ?? '').startsWith('aggregator:')
  if (!body.trim()) {
    // A page we could not read. A hand-chosen or forum-sourced lead still goes
    // to a human, as before. A link scraped off a list page is one of
    // thousands, and an unreadable one is not worth a person's time either.
    return fromAggregator
      ? { keep: false, reason: 'Prefilter: the page could not be read (no text), and it was one link on a list page.' }
      : { keep: true }
  }

  const text = `${title}\n${body}`
  const money = MONEY_RE.test(text)
  const apply = APPLY_RE.test(text)
  const eligibility = ELIGIBILITY_RE.test(text)
  const deadline = DEADLINE_RE.test(text)
  const signals = [money, apply, eligibility, deadline].filter(Boolean).length

  if (!money) {
    return { keep: false, reason: 'Prefilter: the page never mentions a grant, scholarship, award or funding at all.' }
  }
  if (signals < 2) {
    return {
      keep: false,
      reason: 'Prefilter: the page mentions funding but nothing about applying, eligibility or a deadline, so it is a description, not a grant a team can act on.',
    }
  }
  return { keep: true }
}
