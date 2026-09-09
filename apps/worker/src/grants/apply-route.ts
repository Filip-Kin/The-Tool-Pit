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

/** A form is real when it asks for more than an email address. */
function formOnPage(html: string): { fields: number; hasTextarea: boolean; hasFile: boolean; submit: string | null } | null {
  const root = parse(html)
  let best: { fields: number; hasTextarea: boolean; hasFile: boolean; submit: string | null } | null = null
  for (const form of root.querySelectorAll('form')) {
    const action = (form.getAttribute('action') ?? '').toLowerCase()
    const cls = `${form.getAttribute('class') ?? ''} ${form.getAttribute('id') ?? ''}`.toLowerCase()
    if (/search|newsletter|subscribe|login|signin|sign-in|password/.test(action + ' ' + cls)) continue
    const inputs = form.querySelectorAll('input, textarea, select').filter((el) => {
      const type = (el.getAttribute('type') ?? el.tagName).toLowerCase()
      return !['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio'].includes(type)
    })
    const hasTextarea = form.querySelectorAll('textarea').length > 0
    const hasFile = form.querySelectorAll('input[type="file"]').length > 0
    const submit = form.querySelector('button, input[type="submit"]')?.textContent?.trim() || form.querySelector('input[type="submit"]')?.getAttribute('value') || null
    const fields = inputs.length
    if (fields >= 3 || hasTextarea || hasFile) {
      if (!best || fields > best.fields) best = { fields, hasTextarea, hasFile, submit }
    }
  }
  return best
}

/** A page that says "log in" and little else is a portal entrance, which counts once the host is a portal; elsewhere it is unverified. */
const LOGIN_RE = /(log ?in|sign ?in|create (an )?account|register to apply)/i

async function readHtml(url: string): Promise<{ html: string; status: number; how: 'fetch' | 'browser' | 'walled' | 'gone' }> {
  try {
    const res = await politeFetch(url)
    const ct = res.headers.get('content-type') ?? ''
    if (res.ok && /html|xhtml/i.test(ct)) {
      const html = await res.text()
      // A JS shell says nothing; render it.
      if (html.replace(/<script[\s\S]*?<\/script>/gi, '').length > 2500) return { html, status: res.status, how: 'fetch' }
    }
    if (res.ok && !/html/i.test(ct)) return { html: '', status: res.status, how: 'fetch' }
    // Gone is gone: a portal or form that answers 404/410 is not walled, it is dead.
    if (res.status === 404 || res.status === 410) return { html: '', status: res.status, how: 'gone' }
  } catch {
    // fall through to the browser
  }
  const rendered = await withRenderedPage(url, async (page) => page.content())
  if (rendered && rendered.length > 500 && !/just a moment|checking your browser|verify you are human|access denied|request unsuccessful|incapsula/i.test(rendered.slice(0, 3000))) {
    return { html: rendered, status: 200, how: 'browser' }
  }
  return { html: '', status: 0, how: 'walled' }
}

/** Link text or a nearby heading that names the programme a team applies to. Preferred over a funder's other portals. */
const TEAM_CUE = /\b(FIRST|FRC|FTC|FLL|robot|robotics|team|competition|student)\b/i

/** A mailto only counts as the route when the page says to apply that way. */
function applyMailto(html: string): string | null {
  const re = /href="mailto:([^"?]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const around = html.slice(Math.max(0, m.index - 400), m.index + 400).replace(/<[^>]+>/g, ' ')
    if (/\b(apply|application|applications|submit|proposal|request|inquir)/i.test(around)) return m[1].trim()
  }
  return null
}

function judge(url: string, html: string, how: string): Omit<ApplyRoute, 'chain' | 'checkedAt'> | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { status: 'unverified', url: null, email: null, evidence: `not a URL: ${url}` }
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const closed = text.match(CLOSED_RE)
  const portal = portalName(parsed)
  if (closed) {
    return { status: 'closed', url, email: null, evidence: `${portal ?? parsed.hostname} says: "${closed[0]}"` }
  }
  if (portal) {
    return { status: 'portal', url, email: null, evidence: `${portal} at ${parsed.hostname}${LOGIN_RE.test(text.slice(0, 4000)) ? ' (behind an account login)' : ''}, read via ${how}` }
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
    const { html, how, status } = await readHtml(url)
    if (how === 'gone') {
      return { status: 'closed', url, email: null, evidence: `HTTP ${status}: the application page is gone`, chain, checkedAt }
    }
    if (how === 'walled') {
      walledCount++
      // A walled page on a portal host is still the portal.
      try {
        const p = portalName(new URL(url))
        if (p) return { status: 'portal', url, email: null, evidence: `${p} portal (page refused automated reads, host is the destination)`, chain, checkedAt }
      } catch {
        // ignore
      }
      continue
    }
    if (!html) continue
    const verdict = judge(url, html, how)
    if (verdict) return { ...verdict, chain, checkedAt }
    if (!mailto) mailto = applyMailto(html)
    if (depth < 2) {
      // A funder with several portals (community giving AND a FIRST/SAE
      // competition portal) links both; the one whose text names the team
      // programme is the one a team wants.
      const links = findApplyLinks(html, url)
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
