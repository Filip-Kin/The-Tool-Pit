import { describe, expect, it } from 'vitest'
import { dateLinks } from '../src/grants/verify-listing.js'

describe('dateLinks', () => {
  it('ranks the deadlines page first and skips other hosts', () => {
    const html = '<a href="/grants/deadlines">Deadlines &amp; Timeline</a> <a href="/grants/how-to-apply">How to Apply</a> <a href="https://facebook.com/x">Apply</a> <a href="/about">About</a> <a href="/docs/guidelines.pdf">Guidelines (PDF)</a>'
    const links = dateLinks(html, 'https://example.org/grants/')
    expect(links[0]).toBe('https://example.org/grants/deadlines')
    expect(links).toContain('https://example.org/grants/how-to-apply')
    expect(links).toContain('https://example.org/docs/guidelines.pdf')
    expect(links.some((l) => l.includes('facebook'))).toBe(false)
    expect(links.some((l) => l.endsWith('/about'))).toBe(false)
  })
})
