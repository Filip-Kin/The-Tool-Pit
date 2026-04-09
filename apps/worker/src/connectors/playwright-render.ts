/**
 * Playwright-based page renderer.
 * Used as a fallback when static HTML extraction yields too little content
 * (e.g. React/Vue/Svelte SPAs that render everything client-side).
 *
 * Called on-demand by the AI classifier via tool use — not used for every page.
 */

const TIMEOUT_MS = 30_000
const MAX_TEXT_LENGTH = 25_000

/**
 * Renders a URL using a headless Chromium browser and returns the
 * visible body text after JavaScript execution. Returns null on failure.
 */
export async function renderPage(url: string): Promise<string | null> {
  let playwright: typeof import('playwright') | undefined
  try {
    playwright = await import('playwright')
  } catch {
    console.warn('[playwright-render] playwright not installed')
    return null
  }

  const browser = await playwright.chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()

    // Block unnecessary resources to speed up rendering
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (['image', 'media', 'font'].includes(type)) {
        void route.abort()
      } else {
        void route.continue()
      }
    })

    await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS })

    // Get visible text content — runs in browser context as a string to avoid TS DOM lib errors.
    const text = await page.evaluate(`
      document.querySelectorAll('script,style,noscript,svg,iframe,nav,footer').forEach(el => el.remove());
      document.body ? document.body.innerText : '';
    `) as string

    return text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_TEXT_LENGTH) || null
  } catch (err) {
    console.warn(`[playwright-render] error rendering ${url}:`, err)
    return null
  } finally {
    await browser.close()
  }
}
