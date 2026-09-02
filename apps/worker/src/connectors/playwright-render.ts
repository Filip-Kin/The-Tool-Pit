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

const TIMEOUT_MS = 30_000
const MAX_TEXT_LENGTH = 25_000

/** Tags whose contents are never prose. */
const DROP_TAGS = /<(script|style|noscript|svg|head|nav|footer)[\s\S]*?<\/\1>/gi

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

async function renderWithBrowser(url: string): Promise<string | null> {
  let playwright: typeof import('playwright')
  try {
    playwright = await import('playwright')
  } catch {
    return null
  }

  let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | null = null
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      // Set on a machine that has a system chromium but no downloaded browsers.
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    })

    const page = await browser.newPage()

    // Block what cannot carry text, to keep a render inside the timeout.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (['image', 'media', 'font'].includes(type)) void route.abort()
      else void route.continue()
    })

    await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS })

    const text = (await page.evaluate(`
      document.querySelectorAll('script,style,noscript,svg,iframe,nav,footer').forEach(el => el.remove());
      document.body ? document.body.innerText : '';
    `)) as string

    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT_LENGTH) || null
  } catch (err) {
    console.warn(`[render] browser could not read ${url}: ${String(err).split('\n')[0]}`)
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function fetchAsText(url: string): Promise<string | null> {
  try {
    const res = await politeFetch(url)
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('html') && !type.includes('text')) return null
    return htmlToText(await res.text()).slice(0, MAX_TEXT_LENGTH) || null
  } catch {
    return null
  }
}

/**
 * The visible text of a page, or null.
 *
 * A very short browser result counts as a failure worth retrying plainly: a
 * consent wall or a render that timed out mid-load returns a few words, and the
 * raw HTML behind it often holds the whole page.
 */
export async function renderPage(url: string): Promise<string | null> {
  const rendered = await renderWithBrowser(url)
  if (rendered && rendered.length > 200) return rendered

  const fetched = await fetchAsText(url)
  if (fetched && (!rendered || fetched.length > rendered.length)) return fetched
  return rendered ?? fetched
}
