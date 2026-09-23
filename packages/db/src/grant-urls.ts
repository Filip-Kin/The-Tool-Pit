/**
 * Which URLs are the ENTRANCE (a portal, a login, a form, a PDF) and which
 * are the PROGRAMME PAGE (the funder's own words: who, how much, when).
 * A listing needs both: the info link is what a mentor reads, the
 * application link is where they go next. When the sheet or the crawl only
 * had the entrance, the extractor read a login page and the listing came out
 * with no award and no dates (AAUW, American Honda Foundation, 2026-09-09).
 */
const ENTRANCE_HOSTS =
  /(^|\.)(submittable\.com|fluxx\.io|cybergrants\.com|smartsimple\.com|grantinterface\.com|foundant\.com|versaic\.com|yourcausegrants\.com|benevity\.(com|org)|webportalapp\.com|forms\.gle|jotform\.com|typeform\.com|tfaforms\.(net|com)|formassembly\.com|wufoo\.com|formstack\.com|donationx\.org|surveymonkey\.com|qualtrics\.com|alchemer\.com|zohopublic\.com|zfrmz\.com|akoyago\.com|smapply\.io|openwaterapps\.com|hubspot\.com|hsforms\.com|grantrequest\.com|my\.site\.com|force\.com)$/i

// Only a login or a form id says "entrance" by path. "/apply" and
// "/application" on a funder's own site are usually the programme page
// ("/first-robotics-team-grant-application/" was BAE's), and treating them
// as the entrance swapped a good info link for another organisation's post.
const ENTRANCE_PATH = /\/(login|logon|signin|sign-in|user_sessions|sessions\/new|formresponse|viewform|b\/form|jfe\/form|forms?\/[A-Za-z0-9_-]{12,})(\/|$|[.?#])/i

/** True when the URL is the way IN rather than the page ABOUT the grant. */
export function isEntranceUrl(url: string | null | undefined): boolean {
  if (!url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase()
  if (host === 'docs.google.com') return /^\/forms\//i.test(u.pathname)
  if (ENTRANCE_HOSTS.test(host)) return true
  if (/\.pdf(\?|#|$)/i.test(u.pathname)) return true
  if (/quiz\.display_question|urlkey=|x_gm_id=/i.test(u.search)) return true
  if (ENTRANCE_PATH.test(u.pathname)) return true
  if (/^(apply|application|portal|grants?portal|login|forms?)\./i.test(host)) return true
  return false
}

// #region secondhand and archive hosts

/**
 * Grant-finder directories and databases: they describe real grants, but the
 * page is not the funder's, it cannot take an application, and its dates are
 * often its own projection from last year (grantable.co listed Westfield
 * Service League's "January 26, 2027" and Sheltering Arms' "January 30, 2027";
 * neither funder had posted a date, 2026-09 audit). One list for the crawler's
 * prefilter, the aggregator router, the deadline proof and the publish gate.
 */
export const SECONDHAND_GRANT_HOSTS: readonly string[] = [
  'grantable.co',
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
  'stemgrants.com',
  'zeffy.com',
  'linkprotect.cudasvc.com',
]

/** Copies of someone else's page. Evidence of what a page once said, never of what it says now. */
export const ARCHIVE_HOSTS: readonly string[] = ['web.archive.org', 'archive.org', 'archive.ph', 'archive.today', 'archive.is', 'webcache.googleusercontent.com']

function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function onHost(host: string, list: readonly string[]): boolean {
  return host !== '' && list.some((h) => host === h || host.endsWith(`.${h}`))
}

/** True when the URL is a grant-finder directory rather than the funder. */
export function isSecondhandGrantHost(url: string | null | undefined): boolean {
  return onHost(hostOf(url), SECONDHAND_GRANT_HOSTS)
}

/** True when the URL is an archive copy (Wayback Machine and friends). */
export function isArchiveUrl(url: string | null | undefined): boolean {
  return onHost(hostOf(url), ARCHIVE_HOSTS)
}

/** True when the URL is a PDF by its path. */
export function isPdfUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return /\.pdf$/i.test(new URL(url).pathname)
  } catch {
    return /\.pdf(\?|#|$)/i.test(url)
  }
}

/**
 * Words on this URL are not the funder speaking now: a directory's summary or
 * an archive copy. Such a page may point the way to the funder; it never
 * proves a date, and it is never a listing's info link.
 */
export function isThirdPartyGrantUrl(url: string | null | undefined): boolean {
  return isSecondhandGrantHost(url) || isArchiveUrl(url)
}

// #endregion
