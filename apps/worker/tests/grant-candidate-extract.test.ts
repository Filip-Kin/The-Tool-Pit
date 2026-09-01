import { describe, it, expect } from 'vitest'
import {
  awardIntegersFromPhrase,
  parseTriState,
  readDateRange,
  shouldExtractCandidate,
  validateGrantExtraction,
  verifyQuote,
  verifyUrlPresence,
  type GrantEvidence,
  type RawExtractionPayload,
} from '../src/grants/candidate-extract.js'

/**
 * The extraction pass, tested against fixture pages rather than the API.
 *
 * Everything here is about the same rule: a field is only allowed to carry a
 * value if a quote from one of the two evidence texts supports it. A wrong
 * deadline is worse than no deadline, so the interesting cases are all the
 * ones where the model is confident and the page is silent.
 */

// #region fixtures

/** A funder's own page. Dates written as a window, award written in words. */
const FUNDER_PAGE = `
Westfield Community Foundation STEM Team Grant

The Westfield Community Foundation supports youth robotics teams in Wayne and
Oakland counties. Awards typically range from $500 to $2,000 per team.

Applications open March 1, 2027 and close April 15, 2027.

Applicants must be a registered 501(c)(3) organisation, or apply through a
fiscal sponsor that is one. Teams do not need a Westfield employee as a mentor.

Send the completed application form by post to 41 Mill Street, Westfield MI
48000. Questions go to grants@westfieldcf.example.
`.trim()

/** The blurb a grants database wrote about the same programme. */
const AGGREGATOR_BLURB = `
Eligible applicants include youth robotics teams in southeast Michigan that are
501(c)(3) nonprofits or are sponsored by one. Grants of up to $2,000 support
registration, parts and travel.
`.trim()

/** A real funder page that simply never states a date or an amount. */
const DATELESS_PAGE = `
Hollis Engineering Robotics Support

Hollis Engineering supports local robotics teams with parts, machining time and
mentorship. Teams write to us describing their season and what they need, and we
answer every letter. We have supported teams in the region since 1998.
`.trim()

function evidence(funderPage: string, aggregator = ''): GrantEvidence {
  return { funderPage, aggregator }
}

/** Build the raw model payload for one field, so a case reads as one thing. */
function payload(fields: Record<string, unknown>): RawExtractionPayload {
  return { fields }
}

// #endregion

describe('parseTriState', () => {
  it('reads the three real answers', () => {
    expect(parseTriState('yes')).toBe('yes')
    expect(parseTriState('no')).toBe('no')
    expect(parseTriState('unknown')).toBe('unknown')
  })

  it('accepts booleans, which the model returns about a third of the time', () => {
    expect(parseTriState(true)).toBe('yes')
    expect(parseTriState(false)).toBe('no')
  })

  it('reads the common wordings for the same two answers', () => {
    expect(parseTriState('Y')).toBe('yes')
    expect(parseTriState('true')).toBe('yes')
    expect(parseTriState('required')).toBe('yes')
    expect(parseTriState('Not required')).toBe('no')
  })

  it('turns everything else into unknown rather than picking a side', () => {
    expect(parseTriState(null)).toBe('unknown')
    expect(parseTriState(undefined)).toBe('unknown')
    expect(parseTriState('maybe')).toBe('unknown')
    expect(parseTriState('n/a')).toBe('unknown')
    expect(parseTriState(1)).toBe('unknown')
  })
})

describe('verifyQuote', () => {
  it('finds a quote in the funder page', () => {
    expect(verifyQuote('close April 15, 2027', evidence(FUNDER_PAGE))).toBe('funder_page')
  })

  it('matches across a line break, because the page text is wrapped', () => {
    expect(verifyQuote('teams in Wayne and Oakland counties', evidence(FUNDER_PAGE))).toBe('funder_page')
  })

  it('finds a quote that only the aggregator blurb wrote', () => {
    const source = verifyQuote('teams in southeast Michigan', evidence(FUNDER_PAGE, AGGREGATOR_BLURB))
    expect(source).toBe('aggregator')
  })

  it('prefers the funder page when both texts carry the line', () => {
    const both = evidence('applications close April 15, 2027', 'applications close April 15, 2027')
    expect(verifyQuote('applications close April 15, 2027', both)).toBe('funder_page')
  })

  it('refuses a quote that appears in neither text', () => {
    expect(verifyQuote('the deadline is January 5, 2027', evidence(FUNDER_PAGE, AGGREGATOR_BLURB))).toBeNull()
  })

  it('refuses a quote too short to be evidence of anything', () => {
    expect(verifyQuote('grant', evidence(FUNDER_PAGE))).toBeNull()
  })
})

describe('validateGrantExtraction', () => {
  it('drops a field whose quote is not on the page, and says so', () => {
    const result = validateGrantExtraction(
      payload({
        deadlineAt: {
          value: '2027-01-05',
          quote: 'Applications must be received by January 5, 2027',
          source: 'funder_page',
        },
      }),
      // A page with no dates on it, so the drop is the only thing under test.
      evidence(DATELESS_PAGE, AGGREGATOR_BLURB),
    )

    expect(result.fields.deadlineAt.value).toBeNull()
    expect(result.fields.deadlineAt.quote).toBeNull()
    expect(result.fields.deadlineAt.source).toBeNull()
    expect(result.notes.some((n) => n.startsWith('deadlineAt: quote is in neither text'))).toBe(true)
  })

  it('keeps a field whose quote is really there, and records which text it came from', () => {
    const result = validateGrantExtraction(
      payload({
        mailingAddress: {
          value: '41 Mill Street, Westfield MI 48000',
          quote: 'by post to 41 Mill Street, Westfield MI 48000',
          source: 'funder_page',
        },
        eligibilityText: {
          value: 'Youth robotics teams in southeast Michigan.',
          quote: 'Eligible applicants include youth robotics teams in southeast Michigan',
          source: 'aggregator',
        },
      }),
      evidence(FUNDER_PAGE, AGGREGATOR_BLURB),
    )

    expect(result.fields.mailingAddress.value).toBe('41 Mill Street, Westfield MI 48000')
    expect(result.fields.mailingAddress.source).toBe('funder_page')
    expect(result.fields.eligibilityText.source).toBe('aggregator')
  })

  it('corrects a mislabelled source rather than dropping a real quote', () => {
    const result = validateGrantExtraction(
      payload({
        awardPhrase: {
          value: 'up to $2,000',
          quote: 'Grants of up to $2,000 support registration',
          // The model said funder page; the line is the blurb's.
          source: 'funder_page',
        },
      }),
      evidence(FUNDER_PAGE, AGGREGATOR_BLURB),
    )
    expect(result.fields.awardPhrase.value).toBe('up to $2,000')
    expect(result.fields.awardPhrase.source).toBe('aggregator')
  })

  it('keeps the disagreement between the two texts instead of hiding it', () => {
    const result = validateGrantExtraction(
      payload({
        awardMax: {
          value: 2000,
          quote: 'Awards typically range from $500 to $2,000 per team',
          source: 'funder_page',
          conflict: 'The blurb says grants of up to $2,000 with no lower figure.',
        },
      }),
      evidence(FUNDER_PAGE, AGGREGATOR_BLURB),
    )
    expect(result.fields.awardMax.value).toBe(2000)
    expect(result.fields.awardMax.conflict).toContain('blurb says')
  })

  it('answers unknown, not no, for a yes/no field with no supporting quote', () => {
    const result = validateGrantExtraction(
      payload({
        rookieOnly: { value: 'no', quote: null, source: null },
        requires501c3: {
          value: 'yes',
          quote: 'Applicants must be a registered 501(c)(3) organisation',
          source: 'funder_page',
        },
        requiresEmployeeMentor: {
          value: 'no',
          quote: 'Teams do not need a Westfield employee as a mentor',
          source: 'funder_page',
        },
      }),
      evidence(FUNDER_PAGE),
    )

    expect(result.fields.rookieOnly.value).toBe('unknown')
    expect(result.fields.requires501c3.value).toBe('yes')
    // "no" is a real reading here, and it is not the same as unknown.
    expect(result.fields.requiresEmployeeMentor.value).toBe('no')
  })

  it('comes back all unknown on a page that states no dates at all', () => {
    const result = validateGrantExtraction(
      payload({
        name: { value: 'Hollis Engineering Robotics Support', quote: null, source: null },
        deadlineType: { value: 'rolling', quote: null, source: null },
        deadlineAt: { value: '2027-03-01', quote: 'Applications are due March 1, 2027', source: 'funder_page' },
        opensAt: { value: '2027-01-01', quote: null, source: null },
        cycleYear: { value: 2027, quote: null, source: null },
        decisionAt: { value: null, quote: null, source: null },
        requires501c3: { value: 'no', quote: null, source: null },
        renewable: { value: 'yes', quote: null, source: null },
      }),
      evidence(DATELESS_PAGE),
    )

    expect(result.fields.deadlineAt.value).toBeNull()
    expect(result.fields.opensAt.value).toBeNull()
    expect(result.fields.decisionAt.value).toBeNull()
    expect(result.fields.cycleYear.value).toBeNull()
    expect(result.fields.deadlineType.value).toBeNull()
    // The tri-states say unknown rather than falling back to a blank.
    expect(result.fields.requires501c3.value).toBe('unknown')
    expect(result.fields.renewable.value).toBe('unknown')
    // The name is exempt from the quote rule, so it survives, but it does not
    // get to carry a quote nobody wrote.
    expect(result.fields.name.value).toBe('Hollis Engineering Robotics Support')
    expect(result.fields.name.quote).toBeNull()
  })

  it('fills every field key, so "we did not look" cannot look like "the page did not say"', () => {
    const result = validateGrantExtraction(payload({}), evidence(DATELESS_PAGE))
    expect(Object.keys(result.fields).length).toBe(32)
    for (const [key, field] of Object.entries(result.fields)) {
      expect(field, key).toHaveProperty('value')
      expect(field, key).toHaveProperty('quote')
      expect(field, key).toHaveProperty('source')
    }
  })

  it('keeps an award phrase that has no integer in it', () => {
    const varies = 'Award amounts vary by project and are agreed with the team.'
    const result = validateGrantExtraction(
      payload({
        awardPhrase: { value: 'vary by project', quote: varies, source: 'funder_page' },
        awardMin: { value: null, quote: null, source: null },
        awardMax: { value: null, quote: null, source: null },
      }),
      evidence(`${DATELESS_PAGE}\n${varies}`),
    )

    expect(result.fields.awardPhrase.value).toBe('vary by project')
    expect(result.fields.awardMin.value).toBeNull()
    expect(result.fields.awardMax.value).toBeNull()
  })

  it('reads the integers back out of an award phrase that has them', () => {
    const result = validateGrantExtraction(
      payload({
        awardPhrase: {
          value: 'typically range from $500 to $2,000 per team',
          quote: 'Awards typically range from $500 to $2,000 per team',
          source: 'funder_page',
        },
      }),
      evidence(FUNDER_PAGE),
    )
    expect(result.fields.awardMin.value).toBe(500)
    expect(result.fields.awardMax.value).toBe(2000)
    // The figures inherit the phrase's evidence, they are not free-floating.
    expect(result.fields.awardMax.source).toBe('funder_page')
  })

  it('splits a stated application window into an open and a close date', () => {
    const result = validateGrantExtraction(
      payload({
        deadlineAt: { value: null, quote: null, source: null },
        opensAt: { value: null, quote: null, source: null },
      }),
      evidence(FUNDER_PAGE),
    )

    expect(result.fields.opensAt.value).toBe('2027-03-01')
    expect(result.fields.deadlineAt.value).toBe('2027-04-15')
    expect(result.fields.cycleYear.value).toBe(2027)
    expect(result.fields.opensAt.quote).toContain('Applications open March 1, 2027')
  })

  it('refuses a zoneless timestamp, because 11:59pm somewhere is not a deadline', () => {
    const line = 'Applications close April 15, 2027 at 11:59pm.'
    const result = validateGrantExtraction(
      payload({ deadlineAt: { value: '2027-04-15T23:59:00', quote: line, source: 'funder_page' } }),
      evidence(`${DATELESS_PAGE}\n${line}`),
    )
    expect(result.fields.deadlineAt.value).toBeNull()
  })

  it('keeps a timestamp that carries the funder’s own offset', () => {
    const line = 'Applications close April 15, 2027 at 11:59pm Eastern.'
    const result = validateGrantExtraction(
      payload({ deadlineAt: { value: '2027-04-15T23:59:00-04:00', quote: line, source: 'funder_page' } }),
      evidence(`${DATELESS_PAGE}\n${line}`),
    )
    expect(result.fields.deadlineAt.value).toBe('2027-04-15T23:59:00-04:00')
  })

  it('drops a value outside its own vocabulary', () => {
    const line = 'The Westfield Community Foundation supports youth robotics teams'
    const result = validateGrantExtraction(
      payload({
        applyMethod: { value: 'fax', quote: line, source: 'funder_page' },
        geoScope: { value: 'planetary', quote: line, source: 'funder_page' },
        programs: { value: ['frc', 'vex'], quote: line, source: 'funder_page' },
      }),
      evidence(FUNDER_PAGE),
    )
    expect(result.fields.applyMethod.value).toBeNull()
    expect(result.fields.geoScope.value).toBeNull()
    expect(result.fields.programs.value).toEqual(['frc'])
  })

  it('refuses a contact email and an application URL that are not one', () => {
    const line = 'Questions go to grants@westfieldcf.example'
    const result = validateGrantExtraction(
      payload({
        contactEmail: { value: 'the grants office', quote: line, source: 'funder_page' },
        applicationUrl: { value: 'call the office', quote: line, source: 'funder_page' },
      }),
      evidence(FUNDER_PAGE),
    )
    expect(result.fields.contactEmail.value).toBeNull()
    expect(result.fields.applicationUrl.value).toBeNull()
  })
})

describe('readDateRange', () => {
  it('reads an open and a close out of one sentence', () => {
    const range = readDateRange('Applications open March 1, 2027 and close April 15, 2027.')
    expect(range).toEqual({
      opensAt: '2027-03-01',
      closesAt: '2027-04-15',
      snippet: 'Applications open March 1, 2027 and close April 15, 2027.',
    })
  })

  it('reads a dash-separated window', () => {
    const range = readDateRange('The application window is January 5, 2027 - February 20, 2027.')
    expect(range?.opensAt).toBe('2027-01-05')
    expect(range?.closesAt).toBe('2027-02-20')
  })

  it('ignores a date range with nothing to do with applying', () => {
    expect(readDateRange('The build season runs January 4, 2027 to February 17, 2027.')).toBeNull()
  })

  it('says nothing when two different windows are stated', () => {
    const text = [
      'Applications open March 1, 2027 and close April 15, 2027.',
      'For the second round, applications open June 1, 2027 and close July 15, 2027.',
    ].join('\n')
    expect(readDateRange(text)).toBeNull()
  })

  it('refuses a backwards range', () => {
    expect(readDateRange('Applications open April 15, 2027 to March 1, 2027.')).toBeNull()
  })

  it('says nothing about a page with no dates', () => {
    expect(readDateRange(DATELESS_PAGE)).toBeNull()
  })
})

describe('awardIntegersFromPhrase', () => {
  it('finds nothing in a phrase with no figure', () => {
    expect(awardIntegersFromPhrase('varies by project')).toEqual({ awardMin: null, awardMax: null })
    expect(awardIntegersFromPhrase('in-kind hardware, not cash')).toEqual({ awardMin: null, awardMax: null })
  })

  it('puts a single figure in the maximum', () => {
    expect(awardIntegersFromPhrase('up to $5,000 in kind')).toEqual({ awardMin: null, awardMax: 5000 })
  })

  it('reads a range', () => {
    expect(awardIntegersFromPhrase('typically $500 to $2,000 per team')).toEqual({ awardMin: 500, awardMax: 2000 })
  })

  it('scales k and million', () => {
    expect(awardIntegersFromPhrase('grants of $10k')).toEqual({ awardMin: null, awardMax: 10000 })
    expect(awardIntegersFromPhrase('$1.5 million programme, awards of $25,000')).toEqual({
      awardMin: 25000,
      awardMax: 1_500_000,
    })
  })
})

describe('shouldExtractCandidate', () => {
  it('extracts only what the classifier called an applicable grant', () => {
    expect(shouldExtractCandidate({ classification: { isGrant: true } })).toBe(true)
    expect(shouldExtractCandidate({ classification: { isGrant: false } })).toBe(false)
    expect(shouldExtractCandidate({ classification: null })).toBe(false)
  })

  it('does not pay to read fields off a list page or a press release', () => {
    expect(shouldExtractCandidate({ classification: { isGrant: true, isAggregator: true } })).toBe(false)
    expect(shouldExtractCandidate({ classification: { isGrant: true, isAnnouncement: true } })).toBe(false)
  })
})

describe('verifyQuote, typographic punctuation', () => {
  // Real pages are full of curly apostrophes, en dashes and non-breaking
  // spaces. The model writes the plain ascii versions back, and the check used
  // to drop the field over the difference alone. 51 fields in the first 29
  // production records went that way, deadlines among them.
  const page = (body: string) => evidence(body)

  it('matches a curly apostrophe against a straight one', () => {
    expect(
      verifyQuote("the end of FIRST's fiscal year", page('by June 30, the end of FIRST\u2019s fiscal year')),
    ).toBe('funder_page')
  })

  it('matches an ascii hyphen against an en dash', () => {
    expect(verifyQuote('October 1 - 31', page('Request periods: October 1 \u2013 31'))).toBe('funder_page')
  })

  it('matches across a non-breaking space', () => {
    expect(verifyQuote('June 30, 2026', page('submitted by June\u00a030, 2026'))).toBe('funder_page')
  })

  it('still refuses a paraphrase', () => {
    expect(verifyQuote('applications close at the end of June', page('Requests must be in by June 30'))).toBeNull()
  })

  it('still refuses a quote that is simply absent', () => {
    expect(verifyQuote('awards up to $5,000', page('This programme supports robotics teams.'))).toBeNull()
  })
})

describe('applicationUrl verifies by presence, not by prose', () => {
  // Only 3 of 74 records kept an applicationUrl on the first full backfill, and
  // nearly every drop said "no supporting quote". The URL was usually right
  // there on the page as an anchor. A link is not a sentence.
  const page = (body: string) => evidence(body)

  it('keeps a url that appears in the page', () => {
    expect(
      verifyUrlPresence('https://example.org/apply', page('Apply at https://example.org/apply today')),
    ).toBe('funder_page')
  })

  it('ignores the scheme, a www and a trailing slash', () => {
    expect(verifyUrlPresence('https://www.example.org/apply/', page('see http://example.org/apply'))).toBe(
      'funder_page',
    )
  })

  it('finds one in the aggregator blurb when the page does not have it', () => {
    expect(verifyUrlPresence('https://example.org/apply', evidence('nothing here', 'apply: example.org/apply'))).toBe(
      'aggregator',
    )
  })

  it('refuses a url the model invented', () => {
    expect(verifyUrlPresence('https://example.org/apply', page('This programme has no online form.'))).toBeNull()
  })

  it('refuses an empty url', () => {
    expect(verifyUrlPresence('   ', page('anything'))).toBeNull()
  })
})
