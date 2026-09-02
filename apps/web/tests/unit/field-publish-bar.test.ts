/**
 * The bar a practice field has to clear before it goes on the public map.
 *
 * The gate was coordinates and nothing else. Two published fields carry no
 * email, no booking link and no website, so a team can see the pin and has no
 * way to ask whether they can use it.
 *
 * This is the pure part of that decision, so the rule can be read without a
 * database or an admin session.
 */
import { describe, it, expect } from 'bun:test'
import { fieldPublishBlockers } from '@/lib/fields/publish-bar'

const COMPLETE = {
  latitude: 42.5,
  longitude: -83.4,
  contactInfo: 'practice@team1540.org',
  contactUrl: null,
  website: null,
}

describe('practice field publish bar', () => {
  it('passes a row with a pin and a way to get in touch', () => {
    expect(fieldPublishBlockers(COMPLETE)).toEqual([])
  })

  it('blocks a row with no pin', () => {
    expect(fieldPublishBlockers({ ...COMPLETE, latitude: null })).toHaveLength(1)
    expect(fieldPublishBlockers({ ...COMPLETE, longitude: null })[0]).toContain('pin')
  })

  it('blocks a row nobody can contact', () => {
    const blockers = fieldPublishBlockers({
      ...COMPLETE,
      contactInfo: null,
      contactUrl: null,
      website: null,
    })
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toContain('contact')
  })

  it('counts any one of the three contact routes', () => {
    // A team Discord invite and a Google Form are both real answers, and both
    // appear in the live data. Requiring an email specifically would reject
    // rows that are perfectly actionable.
    for (const route of ['contactInfo', 'contactUrl', 'website'] as const) {
      const row = { ...COMPLETE, contactInfo: null, contactUrl: null, website: null, [route]: 'https://example.org' }
      expect(fieldPublishBlockers(row)).toEqual([])
    }
  })

  it('does not count whitespace as a contact route', () => {
    expect(
      fieldPublishBlockers({ ...COMPLETE, contactInfo: '   ', contactUrl: null, website: null }),
    ).toHaveLength(1)
  })

  it('names every missing thing at once', () => {
    // A reviewer fixing one item and pressing the button again to find another
    // is how a gate becomes a chore. Say all of it the first time.
    const blockers = fieldPublishBlockers({
      latitude: null,
      longitude: null,
      contactInfo: null,
      contactUrl: null,
      website: null,
    })
    expect(blockers).toHaveLength(2)
  })

  it('still lets an unknown availability through', () => {
    // Deliberately NOT a blocker. A field is often listed before its hours are
    // settled, and the contact route is there to answer exactly that question.
    // Blocking would reject rows the existing catalogue itself would fail.
    expect(fieldPublishBlockers(COMPLETE)).toEqual([])
  })
})
