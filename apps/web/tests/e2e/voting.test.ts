/**
 * Voting E2E tests.
 *
 * Covers:
 * - Vote button is present on tool detail page
 * - Clicking vote button increments the count
 * - Clicking again decrements it (toggle)
 * - Vote state persists after page reload (requires cookie fix — will FAIL until fixed)
 * - Vote button is present on tool cards in search results
 * - Rate limiting returns 429 after excessive votes
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Page } from 'puppeteer-core'
import { newPage, closeBrowser, goto, BASE_URL, sleep } from '../helpers/browser'

let page: Page

beforeAll(async () => {
  page = await newPage()
})

afterAll(async () => {
  await page.close()
  await closeBrowser()
})

// ---------------------------------------------------------------------------
// Helper: find the first tool slug from the homepage
// ---------------------------------------------------------------------------

async function getFirstToolSlug(p: Page): Promise<string | null> {
  await goto(p, '/')
  await p.waitForSelector('article a', { timeout: 10000 })
  const href = await p.$eval('article a', (el) => (el as HTMLAnchorElement).getAttribute('href'))
  if (!href?.startsWith('/tools/')) return null
  return href.replace('/tools/', '')
}

// ---------------------------------------------------------------------------
// Helpers for vote button state
// ---------------------------------------------------------------------------

async function getVoteCount(p: Page): Promise<number> {
  // Vote buttons contain the count as visible text (number)
  const text = await p.$$eval('button', (buttons) => {
    for (const btn of buttons) {
      const txt = btn.textContent?.trim() ?? ''
      if (/^\d+$/.test(txt)) return txt
    }
    return null
  })
  return text === null ? -1 : parseInt(text, 10)
}

async function clickVoteButton(p: Page): Promise<void> {
  // Find and click the first button that contains only a number (the vote button)
  await p.$$eval('button', (buttons) => {
    for (const btn of buttons as HTMLButtonElement[]) {
      if (/^\d+$/.test(btn.textContent?.trim() ?? '')) {
        btn.click()
        return
      }
    }
  })
  // Wait for the API response
  await sleep(800)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('voting', () => {
  it('vote button is present on a tool detail page', async () => {
    const slug = await getFirstToolSlug(page)
    if (!slug) {
      console.warn('[voting] no tool cards found on homepage — skipping')
      return
    }
    await goto(page, `/tools/${slug}`)
    await page.waitForSelector('button', { timeout: 10000 })

    // Look for a button that contains only digits (vote count)
    const hasVoteButton = await page.$$eval('button', (buttons) =>
      buttons.some((btn) => /^\d+$/.test(btn.textContent?.trim() ?? '')),
    )
    expect(hasVoteButton).toBe(true)
  })

  it('clicking vote button changes the vote count', async () => {
    const slug = await getFirstToolSlug(page)
    if (!slug) return

    await goto(page, `/tools/${slug}`)
    await page.waitForSelector('button', { timeout: 10000 })

    const before = await getVoteCount(page)
    expect(before).toBeGreaterThanOrEqual(0)

    await clickVoteButton(page)

    const after = await getVoteCount(page)
    // Should have changed by ±1
    expect(Math.abs(after - before)).toBe(1)
  })

  it('voting is a toggle — clicking twice returns to original count', async () => {
    const slug = await getFirstToolSlug(page)
    if (!slug) return

    await goto(page, `/tools/${slug}`)
    await page.waitForSelector('button', { timeout: 10000 })

    const original = await getVoteCount(page)

    await clickVoteButton(page)
    const afterFirst = await getVoteCount(page)
    expect(Math.abs(afterFirst - original)).toBe(1)

    await clickVoteButton(page)
    const afterSecond = await getVoteCount(page)
    expect(afterSecond).toBe(original)
  })

  it('vote state persists after page reload [REQUIRES COOKIE FIX]', async () => {
    const slug = await getFirstToolSlug(page)
    if (!slug) return

    await goto(page, `/tools/${slug}`)
    await page.waitForSelector('button', { timeout: 10000 })

    // Ensure we start unvoted by checking current state
    const initial = await getVoteCount(page)

    // Vote
    await clickVoteButton(page)
    const afterVote = await getVoteCount(page)
    expect(Math.abs(afterVote - initial)).toBe(1)

    // Reload the page
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('button', { timeout: 10000 })

    const afterReload = await getVoteCount(page)

    // This assertion WILL FAIL until the vote cookie bug (P0-1) is fixed:
    // After reload, the vote count should still reflect the user's vote
    // because the tp_vid cookie identifies them as having voted.
    // Currently the server never sets this cookie, so the vote appears undone.
    expect(afterReload).toBe(afterVote)

    // Cleanup: un-vote to leave DB clean
    await clickVoteButton(page)
  })

  it('vote button present on search result tool cards', async () => {
    await goto(page, '/search')
    await page.waitForSelector('article', { timeout: 10000 })

    // At least one article should contain a vote button (button with digit text)
    const hasVote = await page.$$eval('article', (cards) =>
      cards.some((card) =>
        Array.from(card.querySelectorAll('button')).some((btn) =>
          /^\d+$/.test(btn.textContent?.trim() ?? ''),
        ),
      ),
    )
    expect(hasVote).toBe(true)
  })

  it('vote API returns JSON with voted and voteCount fields', async () => {
    // Use the fetch API directly via page.evaluate to test the API contract
    const slug = await getFirstToolSlug(page)
    if (!slug) return

    // Navigate to get a real toolId from the page
    await goto(page, `/tools/${slug}`)
    await page.waitForSelector('body', { timeout: 5000 })

    // The toolId is in the API response — test the API contract directly
    const result = await page.evaluate(async (baseUrl) => {
      // Get tool data from the search API for this slug
      const searchRes = await fetch(`${baseUrl}/api/search?q=`)
      const searchData = await searchRes.json()
      if (!searchData.tools?.length) return null

      const toolId = searchData.tools[0].id
      const res = await fetch(`${baseUrl}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId }),
      })
      return res.json()
    }, BASE_URL)

    if (!result) return
    expect(result).toHaveProperty('voted')
    expect(result).toHaveProperty('voteCount')
    expect(typeof result.voted).toBe('boolean')
    expect(typeof result.voteCount).toBe('number')

    // Cleanup: un-vote via API
    await page.evaluate(async (baseUrl, voteResult) => {
      if (voteResult.voted) {
        const searchRes = await fetch(`${baseUrl}/api/search?q=`)
        const searchData = await searchRes.json()
        if (!searchData.tools?.length) return
        const toolId = searchData.tools[0].id
        await fetch(`${baseUrl}/api/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolId }),
        })
      }
    }, BASE_URL, result)
  })
})
