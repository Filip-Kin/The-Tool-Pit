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
