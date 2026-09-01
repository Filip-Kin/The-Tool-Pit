import { describe, it, expect } from 'vitest'
import {
  formatSuppressionExamples,
  pickSuppressionExamples,
  type SuppressionExample,
} from '../src/grants/suppression-feedback.js'

/**
 * The ranking that decides which past rejections are worth prompt space.
 *
 * The point of the loop is that a suppression makes the NEXT run better. An
 * unranked pile of six unrelated rejections does not do that, so these cases
 * are about the ordering rather than about the text.
 */

function example(partial: Partial<SuppressionExample> & { url: string }): SuppressionExample {
  return {
    kind: 'announcement',
    reason: null,
    title: null,
    discoveredVia: null,
    suppressedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  }
}

describe('pickSuppressionExamples', () => {
  it('puts the same host first, because a site that publishes one press release publishes ten', () => {
    const picked = pickSuppressionExamples(
      [
        example({ url: 'https://elsewhere.example/news/a-grant-was-awarded' }),
        example({ url: 'https://inl.gov/news-release/stem-grant-open' }),
      ],
      { url: 'https://inl.gov/news-release/another-stem-grant' },
      1,
    )
    expect(picked[0].url).toBe('https://inl.gov/news-release/stem-grant-open')
  })

  it('then the same discovery angle, because one query returns one kind of noise', () => {
    const picked = pickSuppressionExamples(
      [
        example({ url: 'https://a.example/x', discoveredVia: 'chief_delphi:https://cd/1' }),
        example({ url: 'https://b.example/y', discoveredVia: 'web_search:robotics grant recipients' }),
      ],
      { url: 'https://c.example/z', discoveredVia: 'web_search:robotics team grant' },
      1,
    )
    expect(picked[0].url).toBe('https://b.example/y')
  })

  it('then a matching final path segment, which is what /grants pages share', () => {
    const picked = pickSuppressionExamples(
      [
        example({ url: 'https://one.example/about' }),
        example({ url: 'https://two.example/grants' }),
      ],
      { url: 'https://three.example/grants' },
      1,
    )
    expect(picked[0].url).toBe('https://two.example/grants')
  })

  it('breaks a tie on recency, so a rule that stopped being true fades out', () => {
    const picked = pickSuppressionExamples(
      [
        example({ url: 'https://old.example/a', suppressedAt: new Date('2025-01-01T00:00:00Z') }),
        example({ url: 'https://new.example/b', suppressedAt: new Date('2026-08-01T00:00:00Z') }),
      ],
      { url: 'https://unrelated.example/c' },
      1,
    )
    expect(picked[0].url).toBe('https://new.example/b')
  })

  it('caps the number it returns, because the prompt is not a database', () => {
    const many = Array.from({ length: 30 }, (_, i) => example({ url: `https://x${i}.example/p` }))
    expect(pickSuppressionExamples(many, { url: 'https://y.example/p' }).length).toBe(6)
  })

  it('survives an unparseable URL on either side', () => {
    const picked = pickSuppressionExamples([example({ url: 'not a url' })], { url: 'also not a url' }, 3)
    expect(picked.length).toBe(1)
  })
})

describe('formatSuppressionExamples', () => {
  it('says nothing at all when nothing has been rejected yet', () => {
    expect(formatSuppressionExamples([])).toBe('')
  })

  it('carries the bucket and the reviewer’s own sentence', () => {
    const text = formatSuppressionExamples([
      example({
        url: 'https://socalftc.org/grants',
        kind: 'aggregator_list',
        reason: 'This lists twenty grants, it is a source to crawl.',
        title: 'Grants | SoCal FTC',
      }),
    ])
    expect(text).toContain('https://socalftc.org/grants')
    expect(text).toContain('A list of several grants, not one grant')
    expect(text).toContain('it is a source to crawl')
  })
})
