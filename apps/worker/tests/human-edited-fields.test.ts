import { describe, it, expect } from 'vitest'
import { withoutHumanEdits, crawlOwnsLink } from '../src/pipeline/publish.js'
import {
  addHumanEdits,
  changedKeys,
  isHumanEdited,
  isHumanEditedLink,
  linkMarker,
  linkTypeFromMarker,
  sameValue,
  HUMAN_EDITABLE_TOOL_KEYS,
} from '@the-tool-pit/db'

/**
 * Owner edits have to survive a crawl.
 *
 * The re-publish in pipeline/publish.ts rewrote a matched tool from its
 * candidate on every pass: the name, the summary, the description, the type,
 * the team flags, the programs, both audience tables and the homepage, github
 * and forum links. So every edit an owner made and every correction an admin
 * made was reverted the next time the crawler came round, and owner editing was
 * cosmetic.
 *
 * The thing worth testing is the promise, not the SQL: a claimed field does not
 * move, an unclaimed one still gets refreshed, and a link an owner CLEARED does
 * not come back. The last one is why the marker lives on tools rather than as a
 * boolean on tool_links, and it is the case a per-row flag cannot express.
 */

/** The update the crawl wants to make, shaped as publish.ts builds it. */
const CRAWL_SET = {
  name: 'frc-tools',
  summary: 'FRC Tools for Fusion',
  description: null,
  toolType: 'github_project',
  isOfficial: false,
  isVendor: false,
  isRookieFriendly: false,
  isTeamCode: false,
  isTeamCad: false,
  teamNumber: null,
  seasonYear: null,
  githubStars: 42,
  chiefDelphiLikes: 7,
  popularityScore: 49,
  confidenceScore: 0.83,
}

describe('withoutHumanEdits', () => {
  it('refreshes everything on a listing nobody has touched', () => {
    expect(withoutHumanEdits(CRAWL_SET, [])).toEqual(CRAWL_SET)
    expect(withoutHumanEdits(CRAWL_SET, null)).toEqual(CRAWL_SET)
    // A row written before the column existed reads as null, not as an error.
    expect(withoutHumanEdits(CRAWL_SET, undefined)).toEqual(CRAWL_SET)
  })

  it('does not overwrite a field a person set', () => {
    const set = withoutHumanEdits(CRAWL_SET, ['name'])
    expect(set).not.toHaveProperty('name')
  })

  it('still refreshes the fields nobody claimed', () => {
    // The whole point of not skipping the row: an owner who fixed the name
    // keeps getting a better summary for free.
    const set = withoutHumanEdits(CRAWL_SET, ['name'])
    expect(set.summary).toBe('FRC Tools for Fusion')
    expect(set.toolType).toBe('github_project')
    expect(set.teamNumber).toBeNull()
  })

  it('keeps refreshing the metrics on a fully claimed listing', () => {
    // Star counts are fetched, not stated. Nobody can claim one, so a listing
    // whose every editable field is owned still gets a current popularity score.
    const set = withoutHumanEdits(CRAWL_SET, [...HUMAN_EDITABLE_TOOL_KEYS])
    expect(set.githubStars).toBe(42)
    expect(set.chiefDelphiLikes).toBe(7)
    expect(set.popularityScore).toBe(49)
    expect(set.confidenceScore).toBe(0.83)
    expect(set).not.toHaveProperty('name')
    expect(set).not.toHaveProperty('summary')
  })

  it('holds every field the re-publish writes and an owner can edit', () => {
    // A key the crawl writes that is missing from the claimable list is a field
    // that silently reverts again, which is the bug this whole thing is for.
    for (const key of ['name', 'summary', 'description', 'toolType', 'isTeamCode', 'isTeamCad', 'teamNumber', 'seasonYear']) {
      expect(withoutHumanEdits(CRAWL_SET, [key])).not.toHaveProperty(key)
    }
  })
})

describe('crawlOwnsLink', () => {
  it('replaces a link nobody set by hand', () => {
    expect(crawlOwnsLink('github', [])).toBe(true)
    expect(crawlOwnsLink('homepage', ['name', 'summary'])).toBe(true)
  })

  it('leaves a link an owner set alone', () => {
    expect(crawlOwnsLink('github', ['link:github'])).toBe(false)
  })

  it('leaves a link an owner CLEARED cleared', () => {
    // There is no tool_links row left to carry a flag, so a boolean on that
    // table could not express this and the crawl would re-insert the dead link
    // the owner just took down.
    expect(crawlOwnsLink('forum', ['link:forum'])).toBe(false)
  })

  it('does not confuse a claimed column with a claimed link of the same name', () => {
    expect(crawlOwnsLink('homepage', ['homepage'])).toBe(true)
  })
})

describe('markers', () => {
  it('round-trips a link type', () => {
    expect(linkMarker('github')).toBe('link:github')
    expect(linkTypeFromMarker('link:github')).toBe('github')
  })

  it('reports a column marker as not a link', () => {
    expect(linkTypeFromMarker('summary')).toBeNull()
  })

  it('reads a claim off the stored list', () => {
    expect(isHumanEdited(['name'], 'name')).toBe(true)
    expect(isHumanEdited(['name'], 'summary')).toBe(false)
    expect(isHumanEdited(null, 'name')).toBe(false)
    expect(isHumanEditedLink(['link:docs'], 'docs')).toBe(true)
    expect(isHumanEditedLink(['docs'], 'docs')).toBe(false)
  })
})

describe('addHumanEdits', () => {
  it('adds a claim and sorts, so two saves of the same thing look the same', () => {
    expect(addHumanEdits([], ['summary', 'name'])).toEqual(['name', 'summary'])
  })

  it('never gives a claim back', () => {
    expect(addHumanEdits(['name'], ['summary'])).toEqual(['name', 'summary'])
  })

  it('reports nothing to write when a save added no claim', () => {
    // Null is how the callers skip the column entirely, so an autosave that
    // changed nothing does not rewrite the array.
    expect(addHumanEdits(['name'], ['name'])).toBeNull()
    expect(addHumanEdits(['name'], [])).toBeNull()
  })

  it('starts from nothing on a row written before the column existed', () => {
    expect(addHumanEdits(null, ['name'])).toEqual(['name'])
  })
})

describe('changedKeys', () => {
  const current = { name: 'AdvantageKit', summary: 'A logging framework', teamNumber: 6328, isTeamCode: false }

  it('claims only what actually moved', () => {
    const posted = { name: 'AdvantageKit', summary: 'A logging and replay framework', teamNumber: 6328 }
    expect(changedKeys(posted, current, HUMAN_EDITABLE_TOOL_KEYS)).toEqual(['summary'])
  })

  it('does not claim a field the form re-posted unchanged', () => {
    // Pressing Save is not an edit. Claiming the whole form would freeze a
    // summary the owner never read and lock the crawler out of it forever.
    const posted = { name: 'AdvantageKit', summary: 'A logging framework', teamNumber: 6328 }
    expect(changedKeys(posted, current, HUMAN_EDITABLE_TOOL_KEYS)).toEqual([])
  })

  it('treats a cleared box and a null column as the same thing', () => {
    expect(changedKeys({ description: '' }, { description: null }, ['description'])).toEqual([])
  })

  it('treats a number posted as text as unchanged', () => {
    expect(changedKeys({ teamNumber: '6328' }, current, ['teamNumber'])).toEqual([])
  })

  it('claims a field that was cleared', () => {
    expect(changedKeys({ summary: null }, current, ['summary'])).toEqual(['summary'])
  })

  it('ignores a key the form did not post', () => {
    expect(changedKeys({}, current, HUMAN_EDITABLE_TOOL_KEYS)).toEqual([])
  })

  it('compares a taxonomy selection as a set, not as an order', () => {
    expect(sameValue(['frc', 'ftc'], ['ftc', 'frc'])).toBe(true)
    expect(changedKeys({ programs: ['ftc', 'frc'] }, { programs: ['frc', 'ftc'] }, ['programs'])).toEqual([])
    expect(changedKeys({ programs: ['frc'] }, { programs: ['frc', 'ftc'] }, ['programs'])).toEqual(['programs'])
  })
})
