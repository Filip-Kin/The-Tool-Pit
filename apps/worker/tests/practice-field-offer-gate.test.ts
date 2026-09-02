/**
 * The gate that decides a thread is offering a practice field.
 *
 * Measured against the first live run, which filed nine candidates and two were
 * real. The seven that were not: a blog post about algae, a thread on team
 * churn rate by region, a discussion of how the California districts went, a
 * question about a tethered field at Worlds, an off-season event announcement,
 * and a post asking whether anyone had leftover reef faces. Every one of them
 * mentions a field somewhere and a word like "available" somewhere else, which
 * is all the old gate asked for.
 */
import { describe, it, expect } from 'bun:test'
import { phrasesInSameSentence } from '../src/listings/connectors/shared.js'

const FIELD = ['practice field', 'full field', 'field time', 'our field']
// The deployed list is single words. What makes them safe is the sentence
// boundary, not the length of the phrase: measured over the 23 threads the
// field queries return, long phrases accepted 2 and single words accepted 23,
// 19 of them real offers.
const OFFER = ['available', 'open', 'come', 'host', 'invite']

describe('an offer has to sit beside the field', () => {
  it('accepts a real offer', () => {
    const post = 'Our practice field is available to teams in southeast Michigan on weekends.'
    expect(phrasesInSameSentence(post, FIELD, OFFER)).not.toBeNull()
  })

  it('accepts an offer that rambles afterwards', () => {
    const post =
      'Our practice field is available to any team that wants it. ' +
      'We built it in 2019 out of leftover lumber and it has been through four seasons, ' +
      'and the story of how we got the carpet is a long one involving a very patient parent.'
    expect(phrasesInSameSentence(post, FIELD, OFFER)).not.toBeNull()
  })

  it('rejects a mention and an offer that are unrelated', () => {
    // The shape of the false positives. Both phrase lists match; nothing in the
    // post is an offer of a field.
    const post =
      'Great discussion on how the districts went this year. ' +
      'A lot of teams asked about scouting data and one mentioned their practice field briefly. ' +
      'On a separate note the new sensor is available to any team that wants to try it out early.'
    expect(phrasesInSameSentence(post, FIELD, OFFER)).toBeNull()
  })

  it('rejects a post with only one half of the pair', () => {
    expect(phrasesInSameSentence('The new controller is available to teams now.', FIELD, OFFER)).toBeNull()
  })

  it('accepts the way teams actually title these', () => {
    // Real titles from Chief Delphi. The long-phrase version of this list
    // missed every one of them, because nobody writes "our practice field is
    // open to any team" when "Practice Field Open" fits in a title.
    for (const title of [
      'Practice Field open for business in Georgia',
      '5026 SF Bay Area Practice Field Now Open!',
      'Greensboro NC Practice Field OPEN',
      'SE Michigan Practice Field Invite',
      'Team 2830 Practice Field Available - Milwaukee Area',
    ]) {
      expect(phrasesInSameSentence(title, FIELD, OFFER)).not.toBeNull()
    }
  })

  it('rejects an empty post, which is what an unfetched thread looks like', () => {
    // The fetch budget can run out mid-run. Skipping is the right way to be
    // wrong: a missed field is one a person can still add, and a queue full of
    // noise is how a reviewer stops opening the queue.
    expect(phrasesInSameSentence('', FIELD, OFFER)).toBeNull()
  })

  it('finds the offer wherever in the post it sits', () => {
    const post =
      'Our field. ' + 'x'.repeat(400) + ' Some other topic entirely. ' +
      'The practice field is available to teams every Saturday.'
    const hit = phrasesInSameSentence(post, FIELD, OFFER)
    expect(hit).not.toBeNull()
    expect(hit!.sentence).toContain('available to teams')
  })

  it('reports which phrases matched, for the reviewer', () => {
    const hit = phrasesInSameSentence('Our full field is available to teams.', FIELD, OFFER)
    expect(hit!.subject).toBe('full field')
    expect(hit!.qualifier).toBe('available')
  })
})
