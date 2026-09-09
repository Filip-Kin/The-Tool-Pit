import { describe, expect, it } from 'vitest'
import { findApplyLinks } from '../src/grants/apply-links.js'

describe('findApplyLinks', () => {
  it('does not treat a product page named application-tooling as an apply link', () => {
    const html = '<a href="/en/products/application-tooling.html">Application Tooling</a><a href="https://forms.example.com/first-team-grant">Apply for a FIRST team grant</a>'
    const links = findApplyLinks(html, 'https://www.te.com/en/about/corporate-responsibility/first.html')
    expect(links.map((l) => l.url)).toEqual(['https://forms.example.com/first-team-grant'])
  })
})
