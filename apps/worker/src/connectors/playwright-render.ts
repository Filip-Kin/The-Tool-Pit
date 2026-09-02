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
    return { text: cleaned, links: sameSiteLinks(links, url) }
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
    return { text, links: sameSiteLinks(links, url) }
  } catch {
    return null
  }
}

/**
 * Links on the same site as the page they were found on, deduplicated.
 *
 * Off-site links are dropped: a sponsor, a map and a social account are most of
 * what an event site links out to, and none of them answers what it costs. The
 * cap is generous because a site's page list is exactly what the reader needs.
 */
function sameSiteLinks(links: string[], pageUrl: string): string[] {
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
    if (parsed.host.replace(/^www\./, '') !== host) continue
    const key = parsed.toString().replace(/#.*$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(link.trim())
    if (out.length >= 60) break
  }
  return out
}

/**
 * The visible text of a page, or null.
 *
 * A very short browser result counts as a failure worth retrying plainly: a
 * consent wall or a render that timed out mid-load returns a few words, and the
 * raw HTML behind it often holds the whole page.
 */
export async function renderPage(url: string): Promise<PageContent | null> {
  const rendered = await renderWithBrowser(url)
  if (rendered && rendered.text.length > 200) return rendered

  const fetched = await fetchAsText(url)
  if (fetched && (!rendered || fetched.text.length > rendered.text.length)) return fetched
  return rendered ?? fetched
}
