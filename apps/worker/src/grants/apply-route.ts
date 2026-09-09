/**
 * Where does "Apply" actually go?
 *
 * A grant listing is only useful if its link lands on the application: the
 * form, the portal, or the inbox. Half the pages the crawl finds are landing
 * pages with an "Apply" button, and the audit of the first 41 listings found
 * links that stopped at a FAQ, a university admissions page, a sandbox
 * instance of the real portal, and a Google Form that had been closed for a
 * year. None of that is a judgement a person should have to make listing by
 * listing, so this resolves it, and the monitor re-resolves it on cadence.
 *
 * Deterministic. It follows "Apply" links (apply-links.ts scores them) at most
 * two hops from the start page and stops at the first page that IS the
 * application: a known portal host, a page carrying a real form, or a mailto.
 * A page that says the form is closed is reported as closed rather than as
 * the destination. A page that refuses every read (Incapsula, Cloudflare) is
 * reported as walled, never guessed at. The verdict always carries one
 * sentence of evidence a reviewer can check.
 */
import { parse } from 'node-html-parser'
import { politeFetch } from '../connectors/base.js'
import { withRenderedPage } from '../connectors/playwright-render.js'
import { findApplyLinks } from './apply-links.js'
import type { GrantApplyRouteStatus } from '@the-tool-pit/db/grant-enums'

export interface ApplyRoute {
  status: GrantApplyRouteStatus
  /** The URL to publish as applicationUrl, when status is portal or form. */
  url: string | null
  /** The address, when status is email. */
  email: string | null
  evidence: string
  /** Every page visited, in order. */
  chain: string[]
  checkedAt: string
}

/** Hosts that ARE application systems. Landing on one is the destination. */
const PORTAL_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)submittable\.com$/i, 'Submittable'],
  [/(^|\.)fluxx\.io$/i, 'Fluxx'],
  [/(^|\.)cybergrants\.com$/i, 'CyberGrants'],
  [/(^|\.)smartsimple\.com$/i, 'SmartSimple'],
  [/(^|\.)grantinterface\.com$/i, 'Foundant'],
  [/(^|\.)foundant\.com$/i, 'Foundant'],
  [/(^|\.)versaic\.com$/i, 'Versaic'],
  [/(^|\.)yourcausegrants\.com$/i, 'YourCause'],
  [/(^|\.)benevity\.(com|org)$/i, 'Benevity'],
  [/(^|\.)webportalapp\.com$/i, 'WebPortalApp'],
  [/(^|\.)forms\.gle$/i, 'Google Forms'],
  [/(^|\.)docs\.google\.com$/i, 'Google Forms'],
  [/(^|\.)forms\.office\.com$/i, 'Microsoft Forms'],
  [/(^|\.)forms\.cloud\.microsoft$/i, 'Microsoft Forms'],
  [/(^|\.)qualtrics\.com$/i, 'Qualtrics'],
  [/(^|\.)alchemer\.com$/i, 'Alchemer'],
  [/(^|\.)surveymonkey\.com$/i, 'SurveyMonkey'],
  [/(^|\.)jotform\.com$/i, 'Jotform'],
  [/(^|\.)typeform\.com$/i, 'Typeform'],
  [/(^|\.)tfaforms\.(net|com)$/i, 'FormAssembly'],
  [/(^|\.)wufoo\.com$/i, 'Wufoo'],
  [/(^|\.)formstack\.com$/i, 'Formstack'],
  [/(^|\.)donationx\.org$/i, 'DonationX'],
  [/(^|\.)allegiancetech\.com$/i, 'Allegiance'],
  [/(^|\.)openwater\.com$/i, 'OpenWater'],
  [/(^|\.)hubspot\.com$/i, 'HubSpot form'],
  [/(^|\.)milogin(tp)?\.michigan\.gov$/i, 'MiLogin (Michigan NexSys)'],
  [/(^|\.)netforum\.aiaa\.org$/i, 'AIAA member portal'],
]

/** Google Forms is only a form on its /forms/ path; docs.google.com hosts documents too. */
function portalName(url: URL): string | null {
  const host = url.hostname.toLowerCase()
  for (const [re, name] of PORTAL_HOSTS) {
    if (!re.test(host)) continue
    if (host.endsWith('docs.google.com') && !/\/forms\//.test(url.pathname)) return null
    return name
  }
  return null
}

/** Phrases that mean the form exists but is not taking submissions. */
const CLOSED_RE =
  /(no longer accepting responses|is no longer accepting|this form is closed|form is now closed|not currently accepting|presently no open calls|no open calls for submissions|survey has (already )?expired|has expired|applications? (are|is) (now )?closed|closed for 20\d\d|not accepting (new )?(applications|submissions))/i

/**
 * A form is the APPLICATION when it asks what an application asks: the
 * organisation or team, an amount or budget, a project, a proposal, a file.
 * A contact form (name, email, message), a cookie-preferences dialog (eight
 * toggles and a CANCEL button, te.com), a newsletter box or a site search is
 * not, however many fields it has.
 */
/** Fields only an application asks for. Address, phone and title are on every contact form and prove nothing. */
const APPLICATION_FIELD_RE = /(organi[sz]ation|org[_-]?name|nonprofit|non-profit|charity|team[_ -]?(name|number|no)|school|district|ein|tax[_ -]?id|501|amount|budget|request(ed)?[_ -]?(amount|funding)|project|program(me)?|proposal|grant|sponsor|purpose|mission|determination)/i
const CONTAINER_NOISE_RE = /(cookie|consent|gdpr|privacy|newsletter|subscribe|search|login|signin|sign-in|password|modal|preferences|tracking|banner)/i
const SUBMIT_NOISE_RE = /^(cancel|close|search|subscribe|sign ?in|log ?in|accept|reject|save preferences|ok|dismiss|got it|agree|chat( now)?|start chat|talk to us|contact us|call( us)?|send message)$/i
type FormShape = { fields: number; hasTextarea: boolean; hasFile: boolean; submit: string | null }
function shapeOf(inputs: ReturnType<ReturnType<typeof parse>['querySelectorAll']>, submitEls: ReturnType<ReturnType<typeof parse>['querySelectorAll']>): FormShape | null {
  const real = inputs.filter((el) => {
    const type = (el.getAttribute('type') ?? el.tagName).toLowerCase()
    return !['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio', 'search', 'password'].includes(type)
  })
  const names = real.map((el) => `${el.getAttribute('name') ?? ''} ${el.getAttribute('id') ?? ''} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`)
  const hasTextarea = real.some((el) => el.tagName.toLowerCase() === 'textarea')
  const hasFile = inputs.some((el) => (el.getAttribute('type') ?? '').toLowerCase() === 'file')
  const submits = submitEls.map((b) => (b.textContent || b.getAttribute('value') || '').trim()).filter(Boolean)
  const submit = submits.find((t) => !SUBMIT_NOISE_RE.test(t)) ?? null
  if (submits.length > 0 && !submit) return null
  const applicationLike = names.filter((n) => APPLICATION_FIELD_RE.test(n)).length
  if (!(hasFile || (real.length >= 3 && applicationLike >= 1) || (hasTextarea && applicationLike >= 1))) return null
  return { fields: real.length, hasTextarea, hasFile, submit }
}
function formOnPage(html: string): FormShape | null {
  const root = parse(html)
  let best: FormShape | null = null
  for (const form of root.querySelectorAll('form')) {
    const action = (form.getAttribute('action') ?? '').toLowerCase()
    const cls = `${form.getAttribute('class') ?? ''} ${form.getAttribute('id') ?? ''}`.toLowerCase()
    if (CONTAINER_NOISE_RE.test(action + ' ' + cls)) continue
    const parentCls = `${form.parentNode?.getAttribute?.('class') ?? ''} ${form.parentNode?.getAttribute?.('id') ?? ''}`.toLowerCase()
    if (CONTAINER_NOISE_RE.test(parentCls)) continue
    const shape = shapeOf(form.querySelectorAll('input, textarea, select'), form.querySelectorAll('button, input[type="submit"]'))
    if (shape && (!best || shape.fields > best.fields)) best = shape
  }
  if (best) return best
  // No <form> qualified. A script-mounted form has no <form> element at all;
  // judge the page's own inputs by the same rule, but only with a real
  // submit ("Submit request", not "Accept cookies").
  const shape = shapeOf(root.querySelectorAll('input, textarea, select'), root.querySelectorAll('button, input[type="submit"]'))
  if (shape && shape.fields >= 4 && shape.submit && /submit|send|apply|request|continue/i.test(shape.submit)) return shape
  return null
}

/** A page that says "log in" and little else is a portal entrance, which counts once the host is a portal. */
const LOGIN_RE = /(log ?in|sign ?in|create (an )?account|register to apply)/i
/**
 * A funder's OWN application system: a login or access-token gate on a page
 * that talks about applying. Not a known portal host, but it is where the
 * application lives (first.dowstem.us asks for an access token; AIAA's
 * awards site redirects to its member login; Fabworks' sponsorship form sits
 * behind "sign in to your account").
 */
const OWN_PORTAL_RE = /(submit (a|your) (proposal|application|request)|application portal|applicant portal|grant portal|sponsorship (form|request|application)|access token|log ?in to (apply|your application|continue)|sign in to (apply|your account)|create (an )?account to apply|solicitation)/i
function gatedInput(html: string): boolean {
  return /<input[^>]+type="(password|email|text)"/i.test(html) && /<(button|input)[^>]*(type="submit"|>\s*(log ?in|sign ?in|continue|submit|next)\s*<)/i.test(html)
}

/** Some hosts answer the crawler's honest User-Agent with 403/406 and a browser with 200 (sdspacegrant.sdsmt.edu). One retry as a browser. */
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
async function fetchWithFallback(url: string): Promise<Response> {
  const res = await politeFetch(url)
  if (![401, 403, 406, 429].includes(res.status)) return res
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8' }, redirect: 'follow', signal: controller.signal })
  } catch {
    return res
  } finally {
    clearTimeout(timer)
  }
}

async function readHtml(url: string): Promise<{ html: string; status: number; how: 'fetch' | 'browser' | 'walled' | 'gone' | 'pdf'; finalUrl: string }> {
  let finalUrl = url
  try {
    const res = await fetchWithFallback(url)
    if (res.url && res.url !== url) finalUrl = res.url
    const ct = res.headers.get('content-type') ?? ''
    if (res.ok && /html|xhtml/i.test(ct)) {
      const html = await res.text()
      // A JS shell says nothing; render it.
      if (html.replace(/<script[\s\S]*?<\/script>/gi, '').length > 2500) return { html, status: res.status, how: 'fetch', finalUrl }
    }
    const looksPdf = /pdf/i.test(ct) || /\.pdf(\?|#|$)/i.test(url) || (!/html/i.test(ct) && !/json|image|video|audio/i.test(ct))
    if (res.ok && looksPdf) {
      // A PDF at the application link is the form when it reads like one.
      // Servers label PDFs as octet-stream often enough that the bytes decide.
      try {
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
          if (!/html/i.test(ct)) return { html: '', status: res.status, how: 'fetch', finalUrl }
        }
        const { extractText } = await import('unpdf')
        const { text } = await extractText(bytes, { mergePages: true })
        // A fillable PDF form often has little extractable text; the file
        // name saying "application" or "form" is evidence enough.
        if (/(application|apply|applicant|signature|name of (team|school|organization))/i.test(text) || /(application|app|form)[^/]*\.pdf/i.test(url)) {
          return { html: `<pdf-form>${(text || 'application form').slice(0, 2000).replace(/</g, ' ')}</pdf-form>`, status: res.status, how: 'pdf', finalUrl }
        }
      } catch {
        // unreadable PDF: fall through
      }
      return { html: '', status: res.status, how: 'fetch', finalUrl }
    }
    if (res.ok && !/html/i.test(ct)) return { html: '', status: res.status, how: 'fetch', finalUrl }
    // A 404 to curl is not always a 404 to a browser (Michigan's MiLogin answers
    // 404 with a working page). Ask the browser; gone only if it agrees.
    if (res.status === 404 || res.status === 410) {
      const rendered = await withRenderedPage(url, async (page) => page.content())
      if (rendered && rendered.length > 500 && !/(page not found|404|no longer available|does not exist)/i.test(rendered.replace(/<[^>]+>/g, ' ').slice(0, 3000))) {
        return { html: rendered, status: 200, how: 'browser', finalUrl }
      }
      return { html: '', status: res.status, how: 'gone', finalUrl }
    }
  } catch {
    // fall through to the browser
  }
  const rendered = await withRenderedPage(url, async (page) => page.content())
  if (rendered && rendered.length > 500 && !/just a moment|checking your browser|verify you are human|access denied|request unsuccessful|incapsula/i.test(rendered.slice(0, 3000))) {
    return { html: rendered, status: 200, how: 'browser', finalUrl }
  }
  return { html: '', status: 0, how: 'walled', finalUrl }
}

/**
 * Two link shapes apply-links.ts does not score: an <iframe> that embeds the
 * form (Microsoft Dynamics, HubSpot, Cognito), and a PDF whose link text says
 * it is the application form. Both are where the application lives.
 */
export function embeddedApplyLinks(html: string, pageUrl: string): Array<{ url: string; text: string; score: number }> {
  const out: Array<{ url: string; text: string; score: number }> = []
  const abs = (href: string): string | null => {
    try {
      return new URL(href, pageUrl).toString()
    } catch {
      return null
    }
  }
  for (const m of html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)) {
    const u = abs(m[1])
    if (!u || /youtube|vimeo|maps\.google|google\.com\/maps|recaptcha|doubleclick|facebook|twitter/i.test(u)) continue
    out.push({ url: u, text: 'embedded frame', score: 2 })
  }
  let pageHost = ''
  try {
    pageHost = new URL(pageUrl).hostname.replace(/^www\./, '')
  } catch {
    // no host, no PDF links
  }
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf(?:\?[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!/(application|apply|form|nomination)/i.test(text + ' ' + m[1])) continue
    const u = abs(m[1])
    if (!u) continue
    // A PDF on another organisation's site is that organisation's form (MSC's
    // page linked a charity's own application PDF).
    let host = ''
    try {
      host = new URL(u).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    if (pageHost && host !== pageHost && !host.endsWith(`.${pageHost}`) && !pageHost.endsWith(`.${host}`)) continue
    out.push({ url: u, text, score: 3 })
  }
  return out
}

/** A fetched page that shows no form may build one with JavaScript (BMW's request form). One render settles it. */
async function renderedHtml(url: string): Promise<string | null> {
  const rendered = await withRenderedPage(url, async (page) => page.content())
  return rendered && rendered.length > 500 ? rendered : null
}

/** Link text or a nearby heading that names the programme a team applies to. Preferred over a funder's other portals. */
const TEAM_CUE = /\b(FIRST|FRC|FTC|FLL|robot|robotics|team|competition|student)\b/i

/** A mailto only counts as the route when the page says to apply that way. */
function applyMailto(html: string): string | null {
  const re = /href="mailto:([^"?]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const around = html.slice(Math.max(0, m.index - 300), m.index + 300).replace(/<[^>]+>/g, ' ')
    if (/(email (your|the|a|an|completed) (application|proposal|request|form|letter)|apply by e-?mail|send (your|the|a|completed) (application|proposal|request|form) to|submit(ted)? (it |the form |applications? |proposals? )?(by|via) e-?mail|applications? (should|must|may|can) be (sent|emailed|submitted) to|to apply,? (email|e-mail|contact))/i.test(around)) return m[1].trim()
  }
  return null
}

export function judge(url: string, html: string, how: string): Omit<ApplyRoute, 'chain' | 'checkedAt'> | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { status: 'unverified', url: null, email: null, evidence: `not a URL: ${url}` }
  }
  if (how === 'pdf') {
    return { status: 'form', url, email: null, evidence: `a PDF application form (submit it as the page instructs)` }
  }
  // A product, shop or careers page is never the application, however many
  // inputs it carries (TE's "application tooling" catalogue has a filter form).
  if (/\/(products?|tooling|catalog|catalogue|shop|store|cart|careers?|jobs?|press|news|investors?)(\/|$|[.?#-])/i.test(parsed.pathname)) {
    return null
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const closed = text.match(CLOSED_RE)
  // On a portal host, a webinar, help or about page is still not the form
  // (cybergrants.com/boa/webinars/ is Bank of America's training page).
  const portal = /\/(webinars?|help|faq|faqs|support|about|blog|news|training|resources?|guidelines?|tutorial|docs)(\/|$|[.?#])/i.test(parsed.pathname) ? null : portalName(parsed)
  if (closed) {
    return { status: 'closed', url, email: null, evidence: `${portal ?? parsed.hostname} says: "${closed[0]}"` }
  }
  if (portal) {
    return { status: 'portal', url, email: null, evidence: `${portal} at ${parsed.hostname}${LOGIN_RE.test(text.slice(0, 4000)) ? ' (behind an account login)' : ''}, read via ${how}` }
  }
  if (OWN_PORTAL_RE.test(text.slice(0, 6000)) && (gatedInput(html) || /href="[^"]*(login|sign-?in|signin|account)[^"]*"/i.test(html))) {
    return { status: 'portal', url, email: null, evidence: `the funder's own application system at ${parsed.hostname} (behind a login on a page about applying), read via ${how}` }
  }
  // Reached an apply path and landed on a login: the application is behind it.
  if (/(apply|application|solicitation|submit|portal)/i.test(parsed.pathname) && gatedInput(html) && LOGIN_RE.test(text.slice(0, 4000))) {
    return { status: 'portal', url, email: null, evidence: `login-gated application at ${parsed.hostname}${parsed.pathname.slice(0, 40)}, read via ${how}` }
  }
  const form = formOnPage(html)
  if (form) {
    return {
      status: 'form',
      url,
      email: null,
      evidence: `form on the page with ${form.fields} fields${form.hasTextarea ? ', a text area' : ''}${form.hasFile ? ', a file upload' : ''}${form.submit ? `, submit "${form.submit.slice(0, 30)}"` : ''}, read via ${how}`,
    }
  }
  return null
}

/**
 * Resolve the application route from a start page. `startUrls` are tried in
 * order (the current applicationUrl first, then the info page).
 */
export async function resolveApplyRoute(startUrls: Array<string | null | undefined>): Promise<ApplyRoute> {
  const checkedAt = new Date().toISOString()
  const chain: string[] = []
  const seen = new Set<string>()
  let walledCount = 0
  let mailto: string | null = null

  const queue: Array<{ url: string; depth: number }> = []
  for (const u of startUrls) if (u && !seen.has(u)) { seen.add(u); queue.push({ url: u, depth: 0 }) }

  while (queue.length > 0) {
    const { url, depth } = queue.shift() as { url: string; depth: number }
    chain.push(url)
    const { html, how, status, finalUrl } = await readHtml(url)
    if (how === 'gone') {
      // The application link itself, or an "Apply" link, answering 404 means
      // closed. The info page answering 404 means nothing about the form.
      const wasApplicationLink = depth > 0 || (chain.length === 1 && startUrls[0] === url)
      if (wasApplicationLink) return { status: 'closed', url, email: null, evidence: `HTTP ${status}: the application page is gone`, chain, checkedAt }
      continue
    }
    if (how === 'walled') {
      walledCount++
      // A walled page on a portal host is still the portal.
      try {
        const wu = new URL(url)
        const p = /\/(webinars?|help|faq|faqs|support|about|blog|news|training|resources?|guidelines?|tutorial|docs)(\/|$|[.?#])/i.test(wu.pathname) ? null : portalName(wu)
        if (p) return { status: 'portal', url, email: null, evidence: `${p} portal (page refused automated reads, host is the destination)`, chain, checkedAt }
      } catch {
        // ignore
      }
      continue
    }
    if (!html) continue
    // Judge by where the page ENDED UP: an apply link that redirects to the
    // member login is the login, and the portal host is the final one.
    let verdict = judge(finalUrl, html, how) ?? (finalUrl !== url ? judge(url, html, how) : null)
    if (!verdict && how === 'fetch') {
      const rendered = await renderedHtml(url)
      if (rendered) verdict = judge(finalUrl, rendered, 'browser')
    }
    if (verdict) return { ...verdict, url: verdict.url ? (verdict.status === 'portal' || verdict.status === 'form' ? url : verdict.url) : verdict.url, chain, checkedAt }
    if (!mailto) mailto = applyMailto(html)
    if (depth < 2) {
      // A funder with several portals (community giving AND a FIRST/SAE
      // competition portal) links both; the one whose text names the team
      // programme is the one a team wants.
      const links = [...findApplyLinks(html, url), ...embeddedApplyLinks(html, url)]
        .map((l) => ({ ...l, score: l.score + (TEAM_CUE.test(l.text) ? 3 : 0) }))
        .sort((a, b) => b.score - a.score)
      for (const link of links.slice(0, 3)) {
        if (!seen.has(link.url)) {
          seen.add(link.url)
          queue.push({ url: link.url, depth: depth + 1 })
        }
      }
    }
  }
  if (mailto) return { status: 'email', url: null, email: mailto, evidence: `the page offers a mailto: ${mailto} and no form`, chain, checkedAt }
  if (walledCount > 0 && walledCount === chain.length) {
    return { status: 'walled', url: null, email: null, evidence: `every page refused automated reads (${chain.length} tried)`, chain, checkedAt }
  }
  return { status: 'unverified', url: null, email: null, evidence: `no form, portal or mailto within two hops of ${chain[0] ?? 'the start page'} (${chain.length} pages read)`, chain, checkedAt }
}
