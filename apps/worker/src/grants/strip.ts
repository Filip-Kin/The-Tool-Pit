/**
 * Boilerplate stripping and content hashing for the grant monitor.
 *
 * The monitor is deterministic-first: hash the page, and only spend an AI
 * extraction when the hash actually moved. That whole design rests on this
 * file. A funder page carries a session id in a form token, a "12 people are
 * viewing this" counter, a rotating hero image, a cookie banner with a fresh
 * consent id, a footer with the current year and a build hash. Hash the raw
 * HTML and every page looks changed on every pass, which is one Claude call
 * per grant per pass forever. Strip the chrome first and the same page hashes
 * the same for months, so a hash change is real signal.
 *
 * The strip is deliberately aggressive about navigation and banners and
 * deliberately timid about anything that might be the grant text itself. When
 * in doubt an element stays: a slightly noisy hash costs one extraction, a
 * removed deadline paragraph costs a missed deadline.
 */
import { parse, type HTMLElement } from 'node-html-parser'
import { createHash } from 'node:crypto'

// #region strip rules

/**
 * Tags that never carry the grant's own words. `head` goes because title and
 * meta tags churn (canonical URLs gain tracking params, meta descriptions get
 * A/B tested) while the body copy sits still.
 */
const DROP_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'picture',
  'head',
  'nav',
  'header',
  'footer',
  'aside',
  'dialog',
]

/**
 * id / class fragments that mean chrome on essentially every CMS. Matched on
 * word boundaries against hyphen, underscore and space separated tokens, so
 * `site-header` and `cookie_consent` match but `header-image-of-grant` only
 * matches on its own leading token, and words like `bannerless` do not match
 * at all.
 *
 * `search` and `banner` are in here because both are reliably chrome AND
 * reliably volatile (result counts, rotating promos). `alert` is not, because
 * "the 2027 round is now closed" is very often rendered in an alert box.
 */
const CHROME_TOKENS = [
  'nav',
  'navbar',
  'navigation',
  'menu',
  'submenu',
  'megamenu',
  'header',
  'masthead',
  'topbar',
  'top-bar',
  'toolbar',
  'utility-nav',
  'footer',
  'sidebar',
  'side-bar',
  'breadcrumb',
  'breadcrumbs',
  'cookie',
  'cookies',
  'consent',
  'gdpr',
  'ccpa',
  'privacy-bar',
  'banner',
  'promo',
  'advert',
  'advertisement',
  'ads',
  'social',
  'share',
  'sharing',
  'follow-us',
  'newsletter',
  'subscribe',
  'signup-bar',
  'popup',
  'modal',
  'overlay',
  'lightbox',
  'offcanvas',
  'off-canvas',
  'drawer',
  'skip-link',
  'skip-to-content',
  'screen-reader',
  'sr-only',
  'visually-hidden',
  'search',
  'searchbox',
  'search-form',
  'pagination',
  'pager',
  'back-to-top',
  'related-posts',
  'recent-posts',
  'comments',
  'comment-form',
  'disqus',
  'chat-widget',
  'livechat',
  'cart',
  'minicart',
  'login',
  'account-menu',
  'language-switcher',
  'site-tools',
  'wp-admin-bar',
  'widget-area',
]

const CHROME_RE = new RegExp(`(?:^|[\\s_-])(?:${CHROME_TOKENS.join('|')})(?:$|[\\s_-])`, 'i')

/**
 * A chrome-named wrapper holding most of the page is almost always a false
 * positive: plenty of sites wrap the whole article in `page-header__content`
 * or a `#search-results` shell that also contains the grant listing itself.
 * Above this share of the body text we keep the element and accept the noise.
 */
const CHROME_KEEP_SHARE = 0.35

/** Candidate main-content roots, best first. */
const MAIN_SELECTORS = ['main', '[role="main"]', 'article', '#main-content', '#content', '#main', '.entry-content']

/**
 * A main-content root must hold at least this share of the body text to be
 * trusted. Some templates ship an empty `<main>` and render the real copy
 * beside it; picking that empty root would throw the page away.
 */
const MAIN_MIN_SHARE = 0.25

// #endregion

/** Every class token plus the id, lowercased, for one element. */
function chromeSignature(el: HTMLElement): string {
  const id = el.getAttribute('id') ?? ''
  const cls = el.getAttribute('class') ?? ''
  const role = el.getAttribute('role') ?? ''
  const label = el.getAttribute('aria-label') ?? ''
  return `${id} ${cls} ${role} ${label}`.toLowerCase()
}

/**
 * Collapse whitespace to something stable. HTML minifiers, template engines
 * and CDN transforms all move whitespace around without changing a word, so
 * text that is not normalised hashes differently for no reason.
 */
function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Non-breaking and other exotic spaces show up inconsistently between a
    // cached and an origin render of the same page.
    .replace(/[\u00a0\u2007\u202f\u200b\ufeff]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The page with its chrome removed, as a live element rather than as text.
 * Returns null for junk input rather than throwing.
 *
 * Callers that only want the words should use stripToMainContent. This exists
 * for callers that need to query the surviving tree, for example the crawler
 * asking "is this GitHub link in the page's own content, or in the navbar of a
 * documentation theme that puts the same link on all four hundred pages".
 */
export function mainContentRoot(html: string): HTMLElement | null {
  if (!html || html.length < 40) return null

  let root: HTMLElement
  try {
    root = parse(html, {
      // Keep the raw text of these out of the tree entirely; we drop them
      // below anyway and this avoids parsing a megabyte of inline JS.
      blockTextElements: { script: false, noscript: false, style: false, pre: true },
    })
  } catch {
    return null
  }

  for (const el of root.querySelectorAll(DROP_TAGS.join(','))) el.remove()

  const body = root.querySelector('body') ?? root
  const bodyLength = body.structuredText.replace(/\s+/g, ' ').trim().length
  if (bodyLength === 0) return null

  // Chrome removal by id/class. Walk a snapshot of the list because removing a
  // parent invalidates the children still queued behind it; `isConnected`
  // style checks are not available here, so we simply skip anything whose
  // parent chain has already gone.
  for (const el of body.querySelectorAll('*')) {
    if (!el.parentNode) continue
    const sig = chromeSignature(el)
    if (!sig.trim() || !CHROME_RE.test(sig)) continue
    const share = el.structuredText.replace(/\s+/g, ' ').trim().length / bodyLength
    if (share > CHROME_KEEP_SHARE) continue
    el.remove()
  }

  // Prefer a real main-content root when one exists and is substantial. This
  // is what makes a sidebar-heavy page hash stably even when the chrome rules
  // miss a wrapper we have never seen before.
  let scope: HTMLElement = body
  for (const selector of MAIN_SELECTORS) {
    const found = body.querySelector(selector)
    if (!found) continue
    const share = found.structuredText.replace(/\s+/g, ' ').trim().length / bodyLength
    if (share >= MAIN_MIN_SHARE) {
      scope = found
      break
    }
  }

  return scope
}

/**
 * Turn a fetched HTML page into the stable text a hash and an extractor can
 * both work from. Returns an empty string for junk input rather than throwing,
 * because the caller treats "no content" as a failed fetch already.
 */
export function stripToMainContent(html: string): string {
  const scope = mainContentRoot(html)
  return scope ? normaliseWhitespace(scope.structuredText) : ''
}

/**
 * sha256 of the stripped text, hex. Stored on grants.contentHash and on every
 * snapshot: equal hash means nothing worth reading changed, which is what buys
 * us the "no AI call this pass" branch.
 */
export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
