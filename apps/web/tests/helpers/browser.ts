/**
 * Shared browser/page helpers for Puppeteer E2E tests.
 *
 * Usage pattern per test file:
 *
 *   import { newPage, closeBrowser, url } from '../helpers/browser'
 *
 *   let page: Page
 *   beforeAll(async () => { page = await newPage() })
 *   afterAll(async () => { await page.close(); await closeBrowser() })
 *
 * BASE_URL defaults to http://localhost:3000.
 * Set TEST_BASE_URL env var to override (e.g. for a CI server).
 *
 * PUPPETEER_EXECUTABLE_PATH defaults to /usr/bin/brave-browser.
 * Set the env var to use a different Chromium/Chrome binary.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core'

export const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'

let _browser: Browser | null = null

/** Returns the shared browser instance, launching it on first call. */
export async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/brave-browser',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })
  }
  return _browser
}

/** Opens a fresh page with a standard 1280×800 viewport. */
export async function newPage(): Promise<Page> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  // Suppress noisy console errors from the app bleeding into test output.
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // Only surface console errors if running with VERBOSE_TESTS=1
      if (process.env.VERBOSE_TESTS) console.error('[page]', msg.text())
    }
  })
  return page
}

/** Closes the shared browser. Call in afterAll() of the last test file, or just let the process exit. */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close()
    _browser = null
  }
}

/** Resolves a path against BASE_URL. */
export function url(path: string): string {
  return `${BASE_URL}${path}`
}

// ---------------------------------------------------------------------------
// Page action helpers
// ---------------------------------------------------------------------------

/** Navigate and wait for the page to be fully loaded. */
export async function goto(page: Page, path: string): Promise<void> {
  await page.goto(url(path), { waitUntil: 'networkidle2' })
}

/** Wait for a selector and return its text content. */
export async function getText(page: Page, selector: string): Promise<string> {
  await page.waitForSelector(selector)
  const text = await page.$eval(selector, (el) => el.textContent?.trim() ?? '')
  return text
}

/**
 * Wait for a selector and return the count of matching elements.
 */
export async function count(page: Page, selector: string): Promise<number> {
  await page.waitForSelector(selector)
  return page.$$eval(selector, (els) => els.length)
}

/**
 * Type into an input and optionally submit (press Enter).
 */
export async function typeAndSubmit(
  page: Page,
  selector: string,
  text: string,
  submit = true,
): Promise<void> {
  await page.waitForSelector(selector)
  await page.click(selector, { clickCount: 3 }) // select all existing text
  await page.type(selector, text)
  if (submit) await page.keyboard.press('Enter')
}

/** Sleep for ms milliseconds (replacement for removed page.waitForTimeout). */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Returns the current page URL (full).
 */
export function currentUrl(page: Page): string {
  return page.url()
}

/**
 * Returns the query-string portion of the current URL as a URLSearchParams.
 */
export function currentParams(page: Page): URLSearchParams {
  return new URLSearchParams(new URL(page.url()).search)
}

/**
 * Wait until the URL contains a given string.
 */
export async function waitForUrl(page: Page, substring: string, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    (s) => window.location.href.includes(s),
    { timeout },
    substring,
  )
}
