/**
 * Helpers shared by the grant DISCOVER connectors: URL canonicalisation, a
 * minimal boilerplate strip, page metadata, and funder-name normalisation.
 *
 * NOTE ON THE STRIP: stripToText below is a thin wrapper over
 * stripToMainContent in ../strip.ts, which the MONITOR side uses to build the
 * content hash. They deliberately share one implementation: if DISCOVER read a
 * page differently from MONITOR, a candidate's description and the text its
 * first hash was taken from would disagree, and the first monitor pass would
 * report a change that never happened. Only the truncation is ours.
 */
import { parse } from 'node-html-parser'
import { stripToMainContent } from '../strip.js'

// #region URLs

/** Query parameters that identify a click, not a page. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source',
]

/**
 * Canonical form used as the dedup key: lowercase host, no fragment, no
 * tracking parameters, no trailing slash. Real query strings are KEPT, because
 * plenty of funders serve their grant page as `?page_id=…` and dropping the
 * query would collapse every one of them onto the site root.
 */
export function canonicalGrantUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim().replace(/[).,;:!?'"]+$/, ''))
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname.includes('.')) return null

  for (const p of TRACKING_PARAMS) u.searchParams.delete(p)
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1)
  if (u.pathname === '/') u.pathname = ''
  return u.toString()
}

/** Host of a URL, lowercased and with a leading www. removed. */
export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Hosts that are never a funder's grant page. Two groups, both learned the
 * hard way by the tools vertical: places that talk ABOUT money (forums,
 * social, news, link shorteners) and places that take money (vendors, shops).
 * A lead pointing at any of these is noise a reviewer would reject anyway.
 */
export const NON_FUNDER_HOSTS = [
  // Forums, social, chat. A discussion of a grant is not a grant.
  'chiefdelphi.com', 'reddit.com', 'twitter.com', 'x.com', 'facebook.com',
  'instagram.com', 'linkedin.com', 'youtube.com', 'youtu.be', 'tiktok.com',
  'discord.gg', 'discord.com', 'pinterest.com', 'threads.net', 'medium.com',
  // Search engines and aggregated feeds that would send us round in a circle.
  'google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com', 'yahoo.com',
  'news.google.com', 'msn.com',
  // Reference and archives.
  'wikipedia.org', 'wikimedia.org', 'web.archive.org', 'archive.org',
  // Link shorteners hide their destination, so they can never be a dedup key.
  'bit.ly', 'goo.gl', 'tinyurl.com', 'ow.ly', 'amzn.to', 't.co', 'lnkd.in',
  // Vendors and shops. These sponsor teams with discounts, not grants.
  'andymark.com', 'revrobotics.com', 'vexrobotics.com', 'wcproducts.com',
  'mcmaster.com', 'amazon.com', 'ebay.com', 'digikey.com', 'mouser.com',
  'thriftybot.com', 'gobilda.com', 'servocity.com',
  // Site builders and hosts: a team's own site chrome, not a funder.
  'wix.com', 'wixsite.com', 'squarespace.com', 'weebly.com', 'wordpress.com',
  'godaddy.com', 'github.io', 'netlify.app', 'vercel.app', 'notion.site',
  'docs.google.com', 'drive.google.com', 'sites.google.com', 'forms.gle',
  'paypal.com', 'gofundme.com', 'donorbox.org', 'snapraise.com',
]

/** True when the host is on the blocklist, matching subdomains too. */
export function isNonFunderHost(url: string): boolean {
  const host = hostOf(url)
  if (!host) return true
  return NON_FUNDER_HOSTS.some((b) => host === b || host.endsWith('.' + b))
}

// #endregion

// #region HTML

/**
 * Boilerplate-stripped page text, collapsed onto one line and truncated. The
 * strip itself is ../strip.ts, shared with the monitor. Truncation happens
 * here because the only consumers on this path are a candidate description and
 * a classifier prompt, and a whole page of text in a prompt is money.
 */
export function stripToText(html: string, maxChars = 4000): string {
  return stripToMainContent(html).replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

export interface PageMetadata {
  title?: string
  description?: string
  siteName?: string
  /** Stripped body text, for the description fallback and the classifier. */
  text: string
}

/** Deterministic page metadata. No AI at discovery time, by design. */
export function readPageMetadata(html: string): PageMetadata {
  const root = parse(html)
  const meta = (attr: 'name' | 'property', value: string): string | undefined => {
    const el = root.querySelector(`meta[${attr}="${value}"]`)
    const content = el?.getAttribute('content')?.trim()
    return content && content.length > 0 ? content : undefined
  }

  const title =
    meta('property', 'og:title') ??
    root.querySelector('title')?.textContent?.trim() ??
    root.querySelector('h1')?.textContent?.trim()

  const description =
    meta('name', 'description') ??
    meta('property', 'og:description') ??
    meta('name', 'twitter:description')

  return {
    title: title ? title.replace(/\s+/g, ' ').slice(0, 300) : undefined,
    description: description ? description.replace(/\s+/g, ' ').slice(0, 600) : undefined,
    siteName: meta('property', 'og:site_name'),
    text: stripToText(html),
  }
}

// #endregion

// #region Funder names

/**
 * Legal suffixes stripped when building a funder key. "Foundation", "Trust"
 * and "Fund" are deliberately KEPT: "Gene Haas Foundation" and "Haas
 * Automation" are different entities and merging them would put a machine tool
 * company in the grants list.
 */
const LEGAL_SUFFIXES = [
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'plc',
  'corp', 'corporation', 'co', 'company', 'gmbh', 'ag', 'sa', 'nv', 'bv',
  'pty', 'pte', 'srl', 'spa', 'oy', 'ab', 'as',
]

/**
 * Normalised grouping key for a sponsor name. Case, punctuation, accents,
 * ampersands and legal suffixes all vary between team sites for the same
 * funder, and grouping is the entire value of the sponsor signal.
 */
export function normaliseFunderKey(rawName: string): string {
  let s = rawName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (s.startsWith('the ')) s = s.slice(4)

  // Suffixes stack, e.g. "Acme Co Inc". Peel until the tail is a real word.
  let words = s.split(' ').filter(Boolean)
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1])) {
    words = words.slice(0, -1)
  }
  return words.join(' ')
}

/**
 * Words that mean a link is site furniture rather than a sponsor. Team sponsor
 * pages put "Donate", "Contact us" and "Back to top" in the same grid as the
 * logos, and every one of those would otherwise become a funder.
 */
const NON_SPONSOR_WORDS = [
  'home', 'about', 'about us', 'contact', 'contact us', 'donate', 'sponsor us',
  'become a sponsor', 'sponsorship', 'our sponsors', 'sponsors', 'partners',
  'read more', 'learn more', 'click here', 'more info', 'back', 'top', 'next',
  'previous', 'menu', 'search', 'login', 'log in', 'sign in', 'subscribe',
  'privacy policy', 'terms', 'shop', 'store', 'blog', 'news', 'events',
  'gallery', 'photos', 'team', 'our team', 'meet the team', 'calendar', 'faq',
  'email us', 'volunteer', 'join', 'join us', 'apply', 'thank you',
]

/**
 * True when a scraped string is plausibly an organisation name. Cheap tests
 * only: anything that survives still has to appear on three unrelated team
 * sites before it becomes a candidate, so the threshold does the real work.
 */
export function looksLikeOrganisationName(rawName: string): boolean {
  const name = rawName.replace(/\s+/g, ' ').trim()
  if (name.length < 3 || name.length > 80) return false
  if (!/[a-z]/i.test(name)) return false
  if (NON_SPONSOR_WORDS.includes(name.toLowerCase())) return false
  // A sentence is a caption, not a name.
  if (name.split(' ').length > 8) return false
  if (/^(https?:|www\.)/i.test(name)) return false
  if (/@/.test(name)) return false
  return true
}

// #endregion
