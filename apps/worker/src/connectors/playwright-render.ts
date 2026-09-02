/**
 * Read a page the way a browser would, and fall back to reading it plainly.
 *
 * Used by model/page-reader.ts, which is what the classifier and the listings
 * readers call when they need to see a page they only have a link to.
 *
 * TWO THINGS THIS FILE IS CAREFUL ABOUT, both learned the hard way.
 *
 * It never throws. The browser launch used to sit outside the try, so a worker
 * whose chromium was missing or broken threw out of renderPage and took the
 * whole classification down with it, reported as a crash rather than as a page
 * that would not load. Every failure here is a null, which every caller already
 * handles.
 *
 * And a failed render is not the end. An event site is very often Wix or Google
 * Sites and needs the browser, but plenty of pages are plain HTML and a fetch
 * reads them fine. Falling back means "chromium is not installed on this box"
 * degrades to slightly worse reading rather than to no reading at all.
 */
import { politeFetch } from './base.js'

const TIMEOUT_MS = 20_000
/** How long to wait for the JavaScript that fills a page in, after the DOM. */
const SETTLE_MS = 4_000
const MAX_TEXT_LENGTH = 25_000

/** Tags whose contents are never prose. */
const DROP_TAGS = /<(script|style|noscript|svg|head|nav|footer)[\s\S]*?<\/\1>/gi

/**
 * A page's visible text AND the links on it.
 *
 * THE LINKS ARE THE POINT. innerText carries no hrefs, so a reader handed only
 * the text has no way to know what a page links to and starts guessing paths.
 * That is not hypothetical: reading Bordie Blast, it guessed
 * /registration and /schedule, both of which 404, and never found
 * /bordie-through-time-2026, which is the actual event page with the venue and
 * the cost on it. The home page linked it the whole time.
 */
export interface PageContent {
  text: string
  /** Same-site links, as `label → url`, in document order. */
  links: string[]
}

/** Visible text out of raw HTML, for the no-browser path. */
export function htmlToText(html: string): string {
  return html
    .replace(DROP_TAGS, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * ONE BROWSER, kept alive between pages.
 *
 * A launch is about a second and a fair amount of memory, and the reader opens
 * up to eight pages per candidate across dozens of candidates. Launching per
 * page made a single read take five minutes, which is most of a night for one
 * sweep. The browser is started on first use and closed on shutdown; a crashed
 * browser is dropped and the next call starts a fresh one.
 */
let browserPromise: Promise<import('playwright').Browser | null> | null = null

async function getBrowser(): Promise<import('playwright').Browser | null> {
  if (browserPromise) {
    const existing = await browserPromise
    if (existing?.isConnected()) return existing
    // Crashed or closed underneath us. Forget it and start again.
    browserPromise = null
  }

  browserPromise = (async () => {
    let playwright: typeof import('playwright')
    try {
      playwright = await import('playwright')
    } catch {
      return null
    }
    try {
      return await playwright.chromium.launch({
        headless: true,
        // Set on a machine that has a system chromium but no downloaded browsers.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {}),
      })
    } catch (err) {
      console.warn(`[render] no browser available: ${String(err).split('\n')[0]}`)
      return null
    }
  })()

  return browserPromise
}

/**
 * Wait for lazily-loaded content to stop arriving.
 *
 * Counts the short numbers across every frame and waits until that count holds
 * steady between checks, which is what a roster table does once it has finished
 * filling in. Bounded, so a page that never settles is not waited on forever.
 */
async function settleDynamicContent(page: import('playwright').Page): Promise<void> {
  // Up to 30 seconds. A Wix data widget in a cross-origin iframe can take the
  // better part of ten seconds to fill, and a shorter wait catches a partial
  // list or, worse, a transient placeholder: MARC briefly showed a run of years
  // that read as team numbers before its real table arrived. Filip's rule, and
  // it is the right one: if the content is not there after 30 seconds it is not
  // going to be, so take what there is and move on.
  //
  // Settled means the count held across TWO consecutive checks two seconds
  // apart, not one, so a mid-load pause cannot be mistaken for the end.
  let previous = -1
  let stableFor = 0
  for (let i = 0; i < 15; i++) {
    let total = 0
    for (const frame of page.frames()) {
      try {
        total += (await frame.evaluate(`((document.body?document.body.innerText:'').match(/\\b\\d{2,5}\\b/g)||[]).length`)) as number
      } catch {
        // A frame that will not evaluate contributes nothing.
      }
    }
    if (total > 0 && total === previous) {
      if (++stableFor >= 2) return
    } else {
      stableFor = 0
    }
    previous = total
    await page.waitForTimeout(2000).catch(() => {})
  }
}

/**
 * Open a URL, render it, and hand the live page to a callback.
 *
 * For the callers that need the DOM itself rather than its text: the team-list
 * parser reads structure a browser keeps and htmlToText throws away, and it
 * runs a model-authored function against the real DOM in the page's own realm.
 *
 * Same render settings as renderPage (block heavy resources, wait for the DOM
 * then a short settle for a Wix or Squarespace page to fill in), plus a scroll
 * to the bottom, because a lazy list only loads when it comes into view. The
 * context is fresh and cookieless, and it is closed no matter what, which also
 * terminates any script the callback left running in the page.
 *
 * Returns null when no browser is available, exactly like renderPage, so a box
 * with no chromium degrades rather than throws.
 */
export async function withRenderedPage<T>(
  url: string,
  fn: (page: import('playwright').Page) => Promise<T>,
): Promise<T | null> {
  const browser = await getBrowser()
  if (!browser) return null

  let context: import('playwright').BrowserContext | null = null
  try {
    context = await browser.newContext()
    const page = await context.newPage()
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (['image', 'media', 'font'].includes(type)) void route.abort()
      else void route.continue()
    })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {})
    // A team list that lazy-loads needs to be scrolled into view first.
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {})
    // A Wix data widget in a cross-origin iframe loads its host team first and
    // fills the rest in a second or two later, so a single short wait catches a
    // partial list. Wait until the numbers across all frames stop growing, or
    // give up after a few seconds and take what is there.
    await settleDynamicContent(page)
    return await fn(page)
  } catch (err) {
    console.warn(`[render] withRenderedPage failed for ${url}: ${String(err).split('\n')[0]}`)
    return null
  } finally {
    await context?.close().catch(() => {})
  }
}

/** Close the shared browser. Called from the worker's shutdown path. */
export async function closeBrowser(): Promise<void> {
  const browser = browserPromise ? await browserPromise : null
  browserPromise = null
  await browser?.close().catch(() => {})
}

async function renderWithBrowser(url: string): Promise<PageContent | null> {
  const browser = await getBrowser()
  if (!browser) return null

  // A context per page, so cookies and storage from one site never reach the
  // next, and closing it frees everything that page allocated.
  let context: import('playwright').BrowserContext | null = null
  try {
    context = await browser.newContext()
    const page = await context.newPage()

    // Block what cannot carry text, to keep a render inside the timeout.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (['image', 'media', 'font'].includes(type)) void route.abort()
      else void route.continue()
    })

    // NOT networkidle as the goto condition. Plenty of real sites poll or hold
    // a socket open and never go idle, so waiting for it burns the entire
    // timeout on a page that finished rendering in two seconds. Wait for the
    // DOM, then give the network a short grace period for the JavaScript that
    // fills a Wix or Squarespace page in.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {})

    // Links BEFORE the strip, because nav and footer are exactly where a site
    // keeps its page list, and they are removed for the text.
    //
    // NOT JUST ANCHORS. On Wix, Squarespace and Google Sites a "button" is
    // frequently a div with a role, or a real button that routes in
    // JavaScript, and the destination hides in a data attribute. Reading only
    // a[href] on those sites returns a nav bar with nothing in it, which is
    // the state that has the reader guessing paths.
    const links = (await page.evaluate(`
      (() => {
        const out = [];
        const seen = new Set();
        const add = (label, href) => {
          if (!href) return;
          const key = label + '|' + href;
          if (seen.has(key)) return;
          seen.add(key);
          out.push((label || '').replace(/\\s+/g, ' ').trim() + ' \u2192 ' + href);
        };

        for (const a of document.querySelectorAll('a[href]')) {
          add(a.textContent, a.href);
        }

        // Anything that behaves like a button, with a destination stored
        // somewhere a script would read it from.
        for (const el of document.querySelectorAll('button, [role="button"], [role="link"], [onclick]')) {
          const raw =
            el.getAttribute('data-href') ||
            el.getAttribute('data-url') ||
            el.getAttribute('data-link') ||
            el.getAttribute('formaction') ||
            (el.getAttribute('onclick') || '').match(/https?:\\/\\/[^'"\\s)]+/)?.[0] ||
            '';
          if (!raw) continue;
          try {
            add(el.textContent, new URL(raw, location.href).toString());
          } catch {}
        }

        return out;
      })()
    `)) as string[]

    const text = (await page.evaluate(`
      document.querySelectorAll('script,style,noscript,svg,iframe,nav,footer').forEach(el => el.remove());
      document.body ? document.body.innerText : '';
    `)) as string

    const cleaned = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT_LENGTH)
    if (!cleaned) return null
    return { text: cleaned, links: relevantLinks(links, url) }
  } catch (err) {
    console.warn(`[render] browser could not read ${url}: ${String(err).split('\n')[0]}`)
    return null
  } finally {
    await context?.close().catch(() => {})
  }
}

async function fetchAsText(url: string): Promise<PageContent | null> {
  try {
    const res = await politeFetch(url)
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('html') && !type.includes('text')) return null
    const html = await res.text()
    const text = htmlToText(html).slice(0, MAX_TEXT_LENGTH)
    if (!text) return null

    const links: string[] = []
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      try {
        const absolute = new URL(m[1], url).toString()
        const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        links.push(`${label} \u2192 ${absolute}`)
      } catch {
        // A malformed href contributes nothing.
      }
    }
    return { text, links: relevantLinks(links, url) }
  } catch {
    return null
  }
}

/**
 * The links from a page that are worth showing the reader.
 *
 * SAME SITE, PLUS THE FORMS. The first version kept same-host links only, which
 * is exactly wrong for the thing this exists to find: a registration or
 * volunteer form is almost never on the event's own host. NYC Robo Replay is a
 * Google Sites page whose volunteer form is on docs.google.com, so the one link
 * that answered "how do I volunteer" was dropped for being off-site, on a page
 * hosted by the same company.
 *
 * So an off-site link is kept when it is plainly a sign-up: a known form or
 * ticketing host, or a path that says register, volunteer, apply, tickets or
 * pay. Everything else off-site goes, because a sponsor, a map and a social
 * account are most of what an event site links out to and none of them says
 * what it costs or how to enter.
 */
const FORM_HOST =
  /(?:docs\.google\.com\/forms|forms\.gle|eventbrite\.|jotform\.|signupgenius\.|regfox\.|calendly\.|typeform\.|airtable\.com\/(?:shr|app))/i

const SIGNUP_PATH = /(?:^|[/.\-_])(?:regist|signup|sign-up|apply|volunteer|ticket|pay|entry|enter)/i

function relevantLinks(links: string[], pageUrl: string): string[] {
  let host: string
  try {
    host = new URL(pageUrl).host.replace(/^www\./, '')
  } catch {
    return []
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const link of links) {
    const url = link.slice(link.lastIndexOf('\u2192 ') + 2)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }

    const sameSite = parsed.host.replace(/^www\./, '') === host
    const isForm = FORM_HOST.test(url) || SIGNUP_PATH.test(parsed.pathname + parsed.search)
    if (!sameSite && !isForm) continue

    const key = parsed.toString().replace(/#.*$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(link.trim())
    if (out.length >= 60) break
  }
  return out
}

export async function renderPage(url: string): Promise<PageContent | null> {
  const rendered = await renderWithBrowser(url)
  if (rendered && rendered.text.length > 200) return rendered

  const fetched = await fetchAsText(url)
  if (fetched && (!rendered || fetched.text.length > rendered.text.length)) return fetched
  return rendered ?? fetched
}
