/**
 * Admin dashboard E2E tests.
 *
 * These tests require:
 *   ADMIN_SECRET=<value> — must match what the running server uses
 *   (reads from TEST_ADMIN_SECRET env var, falls back to 'change-me-in-production')
 *
 * Covers:
 * - Admin login flow
 * - Overview page renders stats
 * - Tools list page renders and paginates
 * - Analytics page renders all three data tables
 *   (top queries, zero results, AND top clicked — will FAIL until the render bug is fixed)
 * - Broken nav links are caught (crawl-jobs, sources)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Page } from 'puppeteer-core'
import { newPage, closeBrowser, goto, url, sleep } from '../helpers/browser'

const ADMIN_SECRET = process.env.TEST_ADMIN_SECRET ?? 'change-me-in-production'

let page: Page

async function loginAsAdmin(p: Page): Promise<void> {
  await goto(p, '/admin/login')
  await p.waitForSelector('input[type="password"], input[name="password"]', { timeout: 5000 })
  const passwordInput = await p.$(
    'input[type="password"], input[name="password"]',
  )
  if (passwordInput) {
    await passwordInput.click({ clickCount: 3 })
    await passwordInput.type(ADMIN_SECRET)
    await p.keyboard.press('Enter')
    await p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {})
  }
}

beforeAll(async () => {
  page = await newPage()
  await loginAsAdmin(page)
})

afterAll(async () => {
  await page.close()
  await closeBrowser()
})

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe('admin login', () => {
  it('redirects to /admin after successful login', async () => {
    // After loginAsAdmin() in beforeAll, we should be on /admin
    expect(page.url()).toContain('/admin')
    expect(page.url()).not.toContain('/login')
  })

  it('wrong password stays on login page', async () => {
    const p = await newPage()
    await goto(p, '/admin/login')
    const input = await p.$('input[type="password"], input[name="password"]')
    if (input) {
      await input.type('wrong-password-xyz')
      await p.keyboard.press('Enter')
      await sleep(1000)
      expect(p.url()).toContain('/login')
    }
    await p.close()
  })
})

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

describe('admin overview', () => {
  it('renders stat cards', async () => {
    await goto(page, '/admin')
    await page.waitForSelector('body', { timeout: 10000 })
    const bodyText = await page.$eval('body', (el) => el.textContent ?? '')
    // Stat cards include these labels
    expect(bodyText).toMatch(/Published Tools/i)
    expect(bodyText).toMatch(/Searches Today/i)
  })

  it('shows recent crawl jobs section', async () => {
    const bodyText = await page.$eval('body', (el) => el.textContent ?? '')
    expect(bodyText).toMatch(/Crawl Jobs|crawl/i)
  })
})

// ---------------------------------------------------------------------------
// Tools list
// ---------------------------------------------------------------------------

describe('admin tools', () => {
  it('renders published tools list', async () => {
    await goto(page, '/admin/tools')
    await page.waitForSelector('body', { timeout: 10000 })
    const bodyText = await page.$eval('body', (el) => el.textContent ?? '')
    // Status tabs
    expect(bodyText).toMatch(/published|draft/i)
  })
})

// ---------------------------------------------------------------------------
// Analytics — specifically tests the topClicked bug
// ---------------------------------------------------------------------------

describe('admin analytics', () => {
  it('renders the analytics page', async () => {
    await goto(page, '/admin/analytics')
    await page.waitForSelector('body', { timeout: 10000 })
    const h1 = await page.$eval('h1', (el) => el.textContent?.trim() ?? '')
    expect(h1).toMatch(/analytics/i)
  })

  it('shows top search queries table', async () => {
    const bodyText = await page.$eval('body', (el) => el.textContent ?? '')
    expect(bodyText).toMatch(/Top Search Queries/i)
  })

  it('shows zero-result queries table', async () => {
    const bodyText = await page.$eval('body', (el) => el.textContent ?? '')
    expect(bodyText).toMatch(/Zero.Result/i)
  })

  it('shows top clicked tools table', async () => {
    // Wait for all streaming SSR chunks to render (analytics fetches data server-side)
    await page.waitForFunction(
      () => document.body.textContent?.includes('Top Clicked') || document.body.textContent?.includes('Clicked Tools'),
      { timeout: 10000 },
    ).catch(() => {})
    const bodyText = await page.$eval('body', (el) => el.textContent ?? '')
    expect(bodyText).toMatch(/Top Clicked|Clicked Tools/i)
  })
})

// ---------------------------------------------------------------------------
// Nav link health check — catches 404s on sidebar links
// ---------------------------------------------------------------------------

describe('admin nav links', () => {
  const navPaths = [
    '/admin',
    '/admin/tools',
    '/admin/candidates',
    '/admin/submissions',
    '/admin/analytics',
    '/admin/crawls',
    '/admin/sources',
  ]

  for (const path of navPaths) {
    it(`${path} returns a page (not 404)`, async () => {
      const response = await page.goto(url(path), { waitUntil: 'networkidle2' })
      const status = response?.status() ?? 0
      expect(status).toBeLessThan(400)
    })
  }
})
