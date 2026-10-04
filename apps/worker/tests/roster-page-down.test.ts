import { describe, it, expect } from 'bun:test'
import { pageIsDown } from '../src/listings/roster-refresh.js'

// CMRC 2026-10-04: the organiser's domain went on registrar hold, so the
// team-list page did not resolve. That reads TBA, not "Team list unreadable".
describe('pageIsDown', () => {
  it('is down when the name does not resolve', () => {
    expect(pageIsDown({ error: 'TypeError: fetch failed: getaddrinfo ENOTFOUND www.jumpstartrobotics.org' })).toBe(true)
  })
  it.each([404, 410, 500, 502, 503])('is down on HTTP %i', (status) => {
    expect(pageIsDown({ status })).toBe(true)
  })
  it.each([200, 301, 403, 429])('is up on HTTP %i (bot checks and rate limits still render)', (status) => {
    expect(pageIsDown({ status })).toBe(false)
  })
})
