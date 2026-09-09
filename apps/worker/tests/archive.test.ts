import { describe, expect, it } from 'vitest'
import { archiveUrl } from '../src/grants/archive.js'
describe('archiveUrl', () => {
  it('asks for the raw capture', () => {
    expect(archiveUrl('20260801120000', 'https://www.aauw.org/x/')).toBe('https://web.archive.org/web/20260801120000id_/https://www.aauw.org/x/')
  })
})
