import { describe, it, expect } from 'vitest'
import { canonicalizeUrl } from '../src/pipeline/extract.js'

describe('canonicalizeUrl', () => {
  it('strips utm_source', () => {
    expect(canonicalizeUrl('https://example.com/tool?utm_source=github'))
      .toBe('https://example.com/tool')
  })

  it('strips all UTM params', () => {
    expect(canonicalizeUrl(
      'https://example.com/page?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d&utm_term=e',
    )).toBe('https://example.com/page')
  })

  it('strips ref and source params', () => {
    expect(canonicalizeUrl('https://example.com/?ref=homepage&source=newsletter'))
      .toBe('https://example.com/')
  })

  it('preserves non-tracking query params', () => {
    expect(canonicalizeUrl('https://example.com/search?q=robot&page=2'))
      .toBe('https://example.com/search?q=robot&page=2')
  })

  it('removes trailing slash from path', () => {
    expect(canonicalizeUrl('https://example.com/tool/'))
      .toBe('https://example.com/tool')
  })

  it('preserves root trailing slash', () => {
    expect(canonicalizeUrl('https://example.com/'))
      .toBe('https://example.com/')
  })

  it('lowercases hostname', () => {
    expect(canonicalizeUrl('https://GitHub.COM/user/repo'))
      .toBe('https://github.com/user/repo')
  })

  it('returns raw URL on invalid input', () => {
    expect(canonicalizeUrl('not-a-url')).toBe('not-a-url')
  })

  it('handles URL with UTM and trailing slash together', () => {
    expect(canonicalizeUrl('https://example.com/tool/?utm_source=docs'))
      .toBe('https://example.com/tool')
  })

  it('preserves path case (only hostname is lowercased)', () => {
    expect(canonicalizeUrl('https://EXAMPLE.COM/My-Tool'))
      .toBe('https://example.com/My-Tool')
  })
})
