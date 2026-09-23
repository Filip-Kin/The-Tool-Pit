import { describe, it, expect } from 'vitest'
import {
  findDuplicateGrant,
  findEarlierCandidate,
  normalizeApplicationUrl,
  normalizeGrantName,
  type ExistingGrant,
} from '../src/grants/intake-dedupe.js'

const grant = (over: Partial<ExistingGrant>): ExistingGrant => ({
  id: 'g1',
  slug: 'slug',
  name: 'Name',
  funder: null,
  applicationUrl: null,
  ...over,
})

describe('normalizeGrantName', () => {
  it('drops years, FY and season tokens', () => {
    expect(normalizeGrantName('John Deere 2025-2026 FIRST Team Grant Application')).toBe('john deere first team')
    expect(normalizeGrantName('John Deere FIRST Team Grant 2026-2027')).toBe('john deere first team')
    expect(normalizeGrantName('FY27 STEM Education Grant')).toBe('stem education')
    expect(normalizeGrantName('FY 2026 STEM Education Grants')).toBe('stem education')
    expect(normalizeGrantName('Robotics Grant, 2026 Season')).toBe('robotics')
    expect(normalizeGrantName('Robotics Grant 2025–26')).toBe('robotics')
  })
})

describe('normalizeApplicationUrl', () => {
  it('strips the fragment and the trailing slash and keeps the query', () => {
    expect(normalizeApplicationUrl('https://www.Funder.org/apply/#form')).toBe('funder.org/apply')
    expect(normalizeApplicationUrl('https://www.grantinterface.com/Home/Logon?urlkey=montanacf')).toBe('grantinterface.com/home/logon?urlkey=montanacf')
    expect(normalizeApplicationUrl('https://x.org/a/?b=1')).toBe('x.org/a?b=1')
    expect(normalizeApplicationUrl(null)).toBe('')
  })
})

describe('findDuplicateGrant', () => {
  const deere = grant({ id: 'deere', slug: 'john-deere-first-team-grant', name: 'John Deere FIRST Team Grant 2026-2027', funder: 'John Deere' })

  it('matches last cycle of a published grant from the same funder', () => {
    const hit = findDuplicateGrant(
      { name: 'John Deere 2025-2026 FIRST Team Grant Application', funderName: 'john deere', urls: ['https://www.chiefdelphi.com/t/john-deere-grant/123'] },
      [deere],
    )
    expect(hit?.grant.slug).toBe('john-deere-first-team-grant')
    expect(hit?.by).toBe('funder_and_name')
  })

  it('does not match a different programme from the same funder', () => {
    const relationship = grant({ slug: 'brown-rudnick-relationship-grants', name: 'Brown Rudnick Relationship Grants', funder: 'Brown Rudnick' })
    expect(findDuplicateGrant({ name: 'Brown Rudnick Community Grants', funderName: 'Brown Rudnick', urls: [] }, [relationship])).toBeNull()
  })

  it('does not match the same name from a different funder', () => {
    const other = grant({ name: 'STEM Grant', funder: 'Ford Fund' })
    expect(findDuplicateGrant({ name: 'STEM Grant 2026', funderName: 'Toyota USA Foundation', urls: [] }, [other])).toBeNull()
  })

  it('matches a name the publish path prefixed with the funder', () => {
    const viasat = grant({ slug: 'viasat-corporate-giving', name: 'Viasat Corporate Giving Programme', funder: 'Viasat' })
    expect(findDuplicateGrant({ name: 'Corporate Giving Program', funderName: 'Viasat', urls: [] }, [viasat])?.grant.slug).toBe('viasat-corporate-giving')
  })

  it('matches the same application URL on the funder site, name or not', () => {
    const g = grant({ slug: 'boeing-stem', name: 'Boeing STEM Grant', funder: 'Boeing', applicationUrl: 'https://www.boeing.com/community/apply-for-a-grant/' })
    const hit = findDuplicateGrant(
      { name: 'Vendor write-up of a Boeing grant', funderName: 'AndyMark', urls: ['https://boeing.com/community/apply-for-a-grant#top'] },
      [g],
    )
    expect(hit?.by).toBe('application_url')
  })

  it('does not match on a shared portal login alone', () => {
    const colstrip = grant({
      slug: 'colstrip-impacts',
      name: 'Colstrip Impacts Foundation Grant',
      funder: 'Colstrip Impacts Foundation',
      applicationUrl: 'https://www.grantinterface.com/Home/Logon?urlkey=mtcf',
    })
    expect(
      findDuplicateGrant(
        { name: 'Montana Community Foundation Youth Fund', funderName: 'Montana Community Foundation', urls: ['https://www.grantinterface.com/Home/Logon?urlkey=mtcf'] },
        [colstrip],
      ),
    ).toBeNull()
    // The same portal and the same name is the same grant.
    expect(
      findDuplicateGrant(
        { name: 'Colstrip Impacts Foundation Grant 2026', funderName: 'Montana Community Foundation', urls: ['https://www.grantinterface.com/Home/Logon?urlkey=mtcf'] },
        [colstrip],
      )?.by,
    ).toBe('application_url')
  })

  it('does not treat a different query as the same portal', () => {
    const g = grant({ applicationUrl: 'https://www.grantinterface.com/Home/Logon?urlkey=aaa', name: 'A Fund', funder: 'A' })
    expect(findDuplicateGrant({ name: 'A Fund', funderName: 'B', urls: ['https://www.grantinterface.com/Home/Logon?urlkey=bbb'] }, [g])).toBeNull()
  })

  it('needs a name to match by funder', () => {
    expect(findDuplicateGrant({ name: null, funderName: 'John Deere', urls: [] }, [deere])).toBeNull()
  })
})

describe('findEarlierCandidate', () => {
  const t = (s: string) => new Date(s)

  it('marks the later of two open rows for the same page', () => {
    const me = { id: 'b', canonicalUrl: 'https://funder.org/grant/', createdAt: t('2026-09-02') }
    const other = { id: 'a', canonicalUrl: 'https://funder.org/grant', createdAt: t('2026-09-01') }
    expect(findEarlierCandidate(me, [other])?.id).toBe('a')
    // And never the other way round.
    expect(findEarlierCandidate(other, [me])).toBeNull()
  })

  it('breaks a timestamp tie by id', () => {
    const when = t('2026-09-01')
    expect(findEarlierCandidate({ id: 'b', canonicalUrl: 'https://x.org/g', createdAt: when }, [{ id: 'a', canonicalUrl: 'https://x.org/g', createdAt: when }])?.id).toBe('a')
    expect(findEarlierCandidate({ id: 'a', canonicalUrl: 'https://x.org/g', createdAt: when }, [{ id: 'b', canonicalUrl: 'https://x.org/g', createdAt: when }])).toBeNull()
  })

  it('ignores other pages and itself', () => {
    const me = { id: 'a', canonicalUrl: 'https://x.org/g', createdAt: t('2026-09-02') }
    expect(findEarlierCandidate(me, [me, { id: 'z', canonicalUrl: 'https://x.org/h', createdAt: t('2026-09-01') }])).toBeNull()
  })
})
