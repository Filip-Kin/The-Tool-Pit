/**
 * Program pages E2E tests (/frc, /ftc, /fll).
 *
 * Covers:
 * - Page loads and shows program-colored hero
 * - Top tools grid is rendered
 * - Search bar is present
 * - Searching from program page PRESERVES the program filter in URL
 *   (this test FAILS until the program context bug P0-4 is fixed)
 * - "See all" links include program param
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Page } from 'puppeteer-core'
import { newPage, closeBrowser, goto, waitForUrl, currentParams } from '../helpers/browser'

let page: Page

beforeAll(async () => {
  page = await newPage()
})

afterAll(async () => {
  await page.close()
  await closeBrowser()
})

const PROGRAMS = ['frc', 'ftc', 'fll'] as const

for (const prog of PROGRAMS) {
  describe(`/${prog} page`, () => {
    beforeAll(async () => {
      await goto(page, `/${prog}`)
    })

    it(`loads the ${prog.toUpperCase()} heading`, async () => {
      await page.waitForSelector('h1', { timeout: 10000 })
      const h1 = await page.$eval('h1', (el) => el.textContent?.trim().toUpperCase() ?? '')
      expect(h1).toContain(prog.toUpperCase())
    })

    it(`shows at least one tool card`, async () => {
      await page.waitForSelector('article', { timeout: 10000 })
      const cards = await page.$$('article')
      expect(cards.length).toBeGreaterThan(0)
    })

    it(`has a search input`, async () => {
      const input = await page.$('input[type="search"], input[type="text"], input:not([type])')
      expect(input).not.toBeNull()
    })

    it(`"See all" link includes program=${prog} param`, async () => {
      const seeAllLinks = await page.$$eval('a[href*="/search"]', (els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute('href')).filter(Boolean),
      )
      const programLinks = seeAllLinks.filter((h) => h?.includes(`program=${prog}`))
      expect(programLinks.length).toBeGreaterThan(0)
    })

    it(`searching from /${prog} page preserves program=${prog} in URL [REQUIRES BUG FIX P0-4]`, async () => {
      await goto(page, `/${prog}`)
      const input = await page.waitForSelector('input[type="search"], input[type="text"], input:not([type])')
      expect(input).not.toBeNull()

      await input!.click({ clickCount: 3 })
      await input!.type('robot')
      await page.keyboard.press('Enter')

      // Wait for navigation to /search
      await waitForUrl(page, '/search', 5000)

      const params = currentParams(page)

      // This WILL FAIL until P0-4 (program context bug) is fixed:
      // The search bar on program pages should append &program=frc/ftc/fll
      // Currently it navigates to /search?q=robot with no program param.
      expect(params.get('program')).toBe(prog)
      expect(params.get('q')).toBe('robot')
    })
  })
}
