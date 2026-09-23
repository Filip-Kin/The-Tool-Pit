import { describe, expect, it } from 'vitest'
import { autoRouteDenyReason, isAutoRouteDeniedHost } from '../src/grants/route-aggregator.js'
import { deadSourceNote, DEAD_SOURCE_MIN_CANDIDATES } from '../src/grants/connectors/aggregator.js'
import { keepFunderPageUrlIfShown, validateGrantClassification } from '../src/grants/classify.js'

describe('auto-route denylist', () => {
  it.each([
    'https://grantable.co/grants/some-foundation',
    'https://www.instrumentl.com/grants/xyz',
    'https://stemgrants.com/robotics',
    'https://www.ed.gov/grants-and-programs',
    'https://www2.ed.gov/programs/index.html',
    'https://ed.sc.gov/programs/',
    'https://www.zeffy.com/en-US/grants/foo',
    'https://www.grantwatch.com/cat/41',
    'https://www.grantexec.com/x',
    'https://www.tgci.com/funding-sources/MI/top',
  ])('denies %s', (url) => {
    expect(isAutoRouteDeniedHost(url)).toBe(true)
    expect(autoRouteDenyReason(url)).toBeTruthy()
  })

  it.each([
    'https://www.firstinspires.org/robotics/frc/grants',
    'https://michiganfoundation.org/grants',
    'https://fed.gov.example.org/list',
    'https://notzeffy.com/grants',
    'not a url',
  ])('allows %s', (url) => {
    expect(isAutoRouteDeniedHost(url)).toBe(false)
  })
})

describe('dead aggregator source note', () => {
  it('is one line with the date and the threshold', () => {
    const note = deadSourceNote(new Date('2026-09-23T12:00:00Z'))
    expect(note).not.toContain('\n')
    expect(note).toContain('2026-09-23')
    expect(note).toContain(`${DEAD_SOURCE_MIN_CANDIDATES}+`)
  })
})

describe('funderPageUrl', () => {
  it('keeps an absolute URL that is on the page', () => {
    const c = validateGrantClassification({ isAnnouncement: true, funderPageUrl: ' https://funder.org/robotics-grant ' })
    expect(keepFunderPageUrlIfShown(c, 'Apply at https://funder.org/robotics-grant today').funderPageUrl).toBe('https://funder.org/robotics-grant')
  })
  it('drops a URL the page does not contain', () => {
    const c = validateGrantClassification({ funderPageUrl: 'https://funder.org/guessed' })
    expect(keepFunderPageUrlIfShown(c, 'no links here').funderPageUrl).toBeUndefined()
  })
  it('drops a value that is not an http URL', () => {
    expect(validateGrantClassification({ funderPageUrl: 'funder.org/page' }).funderPageUrl).toBeUndefined()
    expect(validateGrantClassification({ funderPageUrl: 42 as never }).funderPageUrl).toBeUndefined()
  })
})
