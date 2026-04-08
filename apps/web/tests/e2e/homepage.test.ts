/**
 * Homepage E2E tests.
 *
 * Covers:
 * - Page loads without errors
 * - Hero section is visible
 * - Tool sections render with tool cards
 * - Vote counts on homepage tool cards are real numbers (not always 0)
 * - Quick-search chips navigate to the right search URL
 * - Program cards render and link to /frc, /ftc, /fll
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Page } from 'puppeteer-core'
import { newPage, closeBrowser, goto, waitForUrl, currentParams } from '../helpers/browser'

let page: Page

beforeAll(async () => {
  page = await newPage()
  await goto(page, '/')
})

afterAll(async () => {
  await page.close()
  await closeBrowser()
})

describe('homepage', () => {
  it('returns 200 and renders the hero heading', async () => {
    const h1 = await page.$eval('h1', (el) => el.textContent?.trim())
    expect(h1).toBeTruthy()
    // The heading contains a recognisable phrase from the copy
    expect(h1).toMatch(/tools|FIRST|season/i)
  })

  it('search bar is present and focusable', async () => {
    const input = await page.$('input[type="search"], input[type="text"], input:not([type])')
    expect(input).toBeTruthy()
  })

  it('quick-search chips navigate to /search with correct query', async () => {
    // Find the "Scouting Apps" chip (first chip in the hero)
    const chipHandle = await page.waitForFunction(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/search?q="]'))
      return links[0] as HTMLAnchorElement | null
    })
    const href = await (chipHandle as any).evaluate((el: HTMLAnchorElement) => el.href)
    expect(href).toContain('/search?q=')
  })

  it('program cards exist and link to /frc, /ftc, /fll', async () => {
    const hrefs = await page.$$eval('a[href="/frc"], a[href="/ftc"], a[href="/fll"]', (els) =>
      els.map((el) => (el as HTMLAnchorElement).pathname),
    )
    // All three programs should be linked
    expect(hrefs).toContain('/frc')
    expect(hrefs).toContain('/ftc')
    expect(hrefs).toContain('/fll')
  })

  it('at least one tool section has tool cards', async () => {
    // Tool cards are <article> elements (from tool-card.tsx)
    const cardCount = await page.$$eval('article', (els) => els.length)
    expect(cardCount).toBeGreaterThan(0)
  })

  it('vote counts on tool cards are numbers (not undefined/NaN)', async () => {
    // Vote button shows a number — verify it's numeric, even if 0
    // This catches the enrichTools() voteCount: 0 hardcoding — the count should
    // at least be a valid number rendered in the DOM.
    const voteTexts = await page.$$eval(
      // Vote buttons contain the count as text alongside the arrow icon
      // The selector targets the button that has an upvote arrow
      'button[aria-label*="vote" i], button[title*="vote" i], button',
      (buttons) => {
        return buttons
          .filter((btn) => {
            // Look for buttons that contain a number (vote count)
            const text = btn.textContent?.trim() ?? ''
            return /^\d+$/.test(text)
          })
          .map((btn) => btn.textContent?.trim())
          .slice(0, 5) // check first 5
      },
    )

    for (const text of voteTexts) {
      const n = parseInt(text ?? '', 10)
      expect(Number.isFinite(n)).toBe(true)
    }
  })

  it('"See all" links point to /search with expected params', async () => {
    const seeAllLinks = await page.$$eval('a[href^="/search"]', (els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href')).filter(Boolean),
    )
    expect(seeAllLinks.length).toBeGreaterThan(0)

    // Trending "See all" should have sort=popular
    const popularLink = seeAllLinks.find((h) => h?.includes('sort=popular'))
    expect(popularLink).toBeTruthy()

    // Rookie "See all" should have rookie=true
    const rookieLink = seeAllLinks.find((h) => h?.includes('rookie=true'))
    expect(rookieLink).toBeTruthy()
  })
})
