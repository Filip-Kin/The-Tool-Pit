/**
 * CLEAN_DOM_EXPR copies open shadow-root content into what the model is shown.
 *
 * Salesforce Experience Cloud pages (ortop.my.site.com) render the team table
 * inside shadow roots, which document.cloneNode(true) does not copy, so the
 * model was shown a page with no teams. Needs a real browser; skipped where
 * chromium cannot launch (set PLAYWRIGHT_CHROMIUM_PATH to point at one).
 */
import { describe, it, expect, afterAll } from 'bun:test'
import { CLEAN_DOM_EXPR } from '../src/listings/team-list-parser.js'

type Browser = import('playwright').Browser

async function launch(): Promise<Browser | null> {
  try {
    const { chromium } = await import('playwright')
    return await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    })
  } catch {
    return null
  }
}

const browser = await launch()
afterAll(async () => {
  await browser?.close()
})

const PAGE = `<!doctype html><html><body>
<h1 data-x="1" style="color:red">FIRST Chance</h1>
<script>window.secret = 1</script>
<c-event-info id="host"><span>light child</span></c-event-info>
<script>
  const host = document.getElementById('host');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>td{}</style><h2>Registered Teams</h2><c-team-table id="inner"></c-team-table><slot></slot>';
  const inner = root.getElementById('inner');
  inner.attachShadow({ mode: 'open' }).innerHTML = '<table><tr><td>254</td><td>The Cheesy Poofs</td></tr><tr><td>1678</td><td>Citrus Circuits</td></tr></table>';
</script>
</body></html>`

describe.skipIf(!browser)('CLEAN_DOM_EXPR', () => {
  it('copies nested open shadow roots into <shadow-root> inside their hosts', async () => {
    const page = await (browser as Browser).newPage()
    await page.setContent(PAGE)
    const html = (await page.evaluate(CLEAN_DOM_EXPR)) as string
    await page.close()

    expect(html).toContain('<c-event-info id="host"><shadow-root><h2>Registered Teams</h2>')
    expect(html).toContain('<c-team-table id="inner"><shadow-root><table>')
    expect(html).toContain('<td>254</td>')
    expect(html).toContain('<td>1678</td>')
    // Light children still follow the shadow content.
    expect(html).toContain('</shadow-root><span>light child</span>')
  })

  it('still strips scripts, styles and data/style attributes', async () => {
    const page = await (browser as Browser).newPage()
    await page.setContent(PAGE)
    const html = (await page.evaluate(CLEAN_DOM_EXPR)) as string
    await page.close()

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('data-x')
    expect(html).not.toContain('color:red')
    expect(html).toContain('<h1>FIRST Chance</h1>')
  })

  it('leaves the live page untouched', async () => {
    const page = await (browser as Browser).newPage()
    await page.setContent(PAGE)
    await page.evaluate(CLEAN_DOM_EXPR)
    const stillThere = await page.evaluate(
      `document.getElementById('host').shadowRoot.getElementById('inner').shadowRoot.querySelectorAll('td').length`,
    )
    await page.close()
    expect(stillThere).toBe(4)
  })
})
