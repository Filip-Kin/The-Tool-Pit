import { describe, it, expect } from 'vitest'
import { detectGrantPageShape, shapeClassification } from '../src/grants/classify.js'

/**
 * Every URL in here is a real grant_candidates row from the first 282 the
 * crawler produced. The positives are the ones Filip picked out of the queue as
 * "not a grant on it's own"; the negatives are candidates from the same run
 * that sit one character away from a guard and must survive it, because a guard
 * that eats a real funder page costs a team money.
 */
describe('detectGrantPageShape', () => {
  describe('grants-index shape', () => {
    const indexes = [
      // Filip's two examples, verbatim from the review.
      'https://socalftc.org/grants',
      'https://www.ftcpenn.org/team-grants',
      // The rest of the nine index pages that came back isGrant=true.
      'https://firstroboticsbc.org/team-grants',
      'https://recf.org/teams/for-participants/grants',
      'https://www.firstinspires.org/robotics/team-grants',
      'https://cafirst.org/grants',
      'https://inl.gov/education/stem/educators/grants',
      'https://www.mtroboticsalliance.org/resources/grants',
      'https://www.theaaea.org/page/grants',
      // Same shape, one segment longer.
      'https://www.firstinspires.org/programs/team-grant-opportunities',
      'https://www.mtroboticsalliance.org/ftc-resources/grants-funding',
    ]

    for (const url of indexes) {
      it(`calls ${url} an aggregator index`, () => {
        expect(detectGrantPageShape(url)?.shape).toBe('aggregator_index')
      })
    }

    it('ignores a trailing slash', () => {
      expect(detectGrantPageShape('https://socalftc.org/grants/')?.shape).toBe('aggregator_index')
    })

    it('fires on the fragment form Filip pasted', () => {
      // https://socalftc.org/grants/#page-content
      expect(detectGrantPageShape('https://socalftc.org/grants/#page-content')?.shape).toBe(
        'aggregator_index',
      )
    })
  })

  describe('single programmes that must survive the index guard', () => {
    const grants = [
      // Matched as a whole segment, never as a suffix. Both of these end in
      // "grant" or "grants" and are one programme.
      'https://www.dfsme.org/dfsme-mini-grants',
      'https://education.lego.com/en-us/grants-and-funding/georgia/boost-grant',
      'https://firstintexas.org/grants/team-grant-faqs',
      'https://isgc.aerospace.illinois.edu/funding/informal-education-grants',
      'https://www.techpointyouth.org/robotgrant',
      'https://www.ghaasfoundation.org/',
      'https://johndeerefirst.submittable.com/submit/330019/2025-2026-john-deere-first-grant-application',
      'https://www.studica.com/studica-robotics-grant-application',
    ]

    for (const url of grants) {
      it(`leaves ${url} to the model`, () => {
        expect(detectGrantPageShape(url)).toBeNull()
      })
    }
  })

  describe('legislature and press shape', () => {
    it("catches a state senate caucus's press office", () => {
      // The one Filip half-remembered: a senator announcing that the Indiana
      // K-12 Robotics Competition Grant is open. in.gov/doe is the real page.
      const v = detectGrantPageShape(
        'https://www.indianasenaterepublicans.com/rogers-applications-open-for-k-12-robotics-competition-grant',
      )
      expect(v?.shape).toBe('legislative_or_press')
    })

    it('catches a bill on a legislature domain', () => {
      const v = detectGrantPageShape(
        'https://www.legis.iowa.gov/docs/publications/LGI/91/attachments/HF504.html',
      )
      expect(v?.shape).toBe('legislative_or_press')
    })

    it('catches a /news-release/ path', () => {
      expect(
        detectGrantPageShape(
          'https://inl.gov/news-release/inl-stem-impact-grant-available-for-eastern-idaho-educators',
        )?.shape,
      ).toBe('legislative_or_press')
    })

    it('catches a /newsroom/ path', () => {
      expect(
        detectGrantPageShape(
          'https://ocm.auburn.edu/newsroom/news_articles/2022/04/180915-stem-education-in-rural-al.php',
        )?.shape,
      ).toBe('legislative_or_press')
    })

    it('does not read "house" inside another word', () => {
      // warehouse, clubhouse, powerhouse. This is why the host guard needs a
      // label boundary rather than a bare substring.
      expect(detectGrantPageShape('https://www.warehouse-robotics.org/apply')).toBeNull()
      expect(detectGrantPageShape('https://clubhouse.org/stem-fund')).toBeNull()
    })

    it('leaves a funder\'s own /news-resources/ area alone', () => {
      // gafirst.org files a live Google team support grant under here, so a
      // broad /news/ guard would have cost a real listing.
      expect(
        detectGrantPageShape(
          'https://gafirst.org/news-resources/2025-2026-georgiafirst-tech-challengenbsp-google-team-support-grant',
        ),
      ).toBeNull()
    })
  })

  it('returns null rather than throwing on an unparseable URL', () => {
    expect(detectGrantPageShape('not a url')).toBeNull()
  })
})

describe('shapeClassification', () => {
  it('marks an index as an aggregator and not a grant', () => {
    const cls = shapeClassification(detectGrantPageShape('https://socalftc.org/grants')!)
    expect(cls.isAggregator).toBe(true)
    expect(cls.isGrant).toBe(false)
    expect(cls.isAnnouncement).toBe(false)
    expect(cls.confidence).toBe(0)
    expect(cls.reasoning).toContain('grant_sources')
  })

  it('marks a bill as an announcement and not a grant', () => {
    const cls = shapeClassification(
      detectGrantPageShape('https://www.legis.iowa.gov/docs/publications/LGI/91/HF504.html')!,
    )
    expect(cls.isAnnouncement).toBe(true)
    expect(cls.isGrant).toBe(false)
    expect(cls.isAggregator).toBe(false)
    expect(cls.confidence).toBe(0)
  })
})
