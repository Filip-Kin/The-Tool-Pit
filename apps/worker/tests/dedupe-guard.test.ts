import { describe, it, expect } from 'vitest'
import {
  urlDedupeKey,
  sameLinkUrl,
  suppressionBlocksName,
} from '../src/pipeline/deduplicate.js'

/**
 * The pure decisions behind tool deduplication, tested without a database.
 *
 * These guard four import bugs that shipped duplicates once:
 *   1. http:// and https:// of one page filed as two tools.
 *   4. (URL half) a stray trailing slash or leading www splitting one tool.
 *   3. an import republishing over a listing a human had suppressed by hand.
 * Each assertion names the offending value so a regression reads out loud.
 */

describe('urlDedupeKey', () => {
  const canonical = 'lopreiato.me/frc-cycle-times'

  const variants = [
    'http://lopreiato.me/frc-cycle-times',
    'https://lopreiato.me/frc-cycle-times',
    'https://www.lopreiato.me/frc-cycle-times',
    'https://lopreiato.me/frc-cycle-times/',
    'http://WWW.Lopreiato.ME/frc-cycle-times/',
  ]

  for (const v of variants) {
    it(`normalizes ${v} to the same key`, () => {
      const key = urlDedupeKey(v)
      if (key !== canonical) {
        throw new Error(`urlDedupeKey(${v}) = "${key}", expected "${canonical}"`)
      }
      expect(key).toBe(canonical)
    })
  }

  it('keeps genuinely different paths apart', () => {
    expect(urlDedupeKey('https://example.com/a')).not.toBe(urlDedupeKey('https://example.com/b'))
  })

  it('keeps different hosts apart', () => {
    expect(urlDedupeKey('https://a.com/x')).not.toBe(urlDedupeKey('https://b.com/x'))
  })

  it('preserves a query string, which can select a different resource', () => {
    expect(urlDedupeKey('https://example.com/view?id=1')).not.toBe(
      urlDedupeKey('https://example.com/view?id=2'),
    )
  })
})

describe('sameLinkUrl', () => {
  it('treats http and https of one page as the same link', () => {
    expect(sameLinkUrl('http://x.com/tool', 'https://x.com/tool')).toBe(true)
  })

  it('treats a trailing slash as the same link', () => {
    expect(sameLinkUrl('https://x.com/tool', 'https://x.com/tool/')).toBe(true)
  })

  it('treats different pages as different links', () => {
    expect(sameLinkUrl('https://x.com/a', 'https://x.com/b')).toBe(false)
  })
})

describe('suppressionBlocksName', () => {
  it('a published tool always blocks a same-name import', () => {
    expect(suppressionBlocksName('published', [])).toBe(true)
    expect(suppressionBlocksName('published', null)).toBe(true)
  })

  it('a HUMAN-suppressed tool blocks (a moderator hid it on purpose)', () => {
    const blocks = suppressionBlocksName('suppressed', ['status', 'adminNotes'])
    if (!blocks) {
      throw new Error('human-suppressed tool did not block a same-name republish')
    }
    expect(blocks).toBe(true)
  })

  it('an AUTO-suppressed tool does NOT block (spam must not reject real listings)', () => {
    // Auto-suppression leaves human_edited_fields without 'status'.
    const blocks = suppressionBlocksName('suppressed', ['name'])
    if (blocks) {
      throw new Error('auto-suppressed spam blocked a real listing — the 22-names bug')
    }
    expect(blocks).toBe(false)
    expect(suppressionBlocksName('suppressed', [])).toBe(false)
    expect(suppressionBlocksName('suppressed', null)).toBe(false)
  })

  it('a draft never blocks', () => {
    expect(suppressionBlocksName('draft', ['status'])).toBe(false)
  })
})
