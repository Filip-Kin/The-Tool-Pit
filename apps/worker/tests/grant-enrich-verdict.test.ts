import { describe, it, expect } from 'vitest'
import { machineRejectionKind } from '../src/grants/enrich.js'
import { detectGrantPageShape, shapeClassification } from '../src/grants/classify.js'
import type { GrantClassification } from '@the-tool-pit/db'

/**
 * The verdict a grant candidate gets after classification decides where it goes.
 *
 * The pending queue is a moderator's inbox and is only useful if every row on
 * it still needs a person. Two verdicts do:
 *   - a real grant, which a human must approve on the deck, and
 *   - an aggregator list, which a human routes to grant_sources.
 * Everything the classifier is sure is NOT a grant a team can apply for is a
 * decision already made, so it is SUPPRESSED with a rejection_kind (the
 * machine-readable half the suppression-feedback loop reads) instead of
 * clogging the inbox. machineRejectionKind returns null for the two that stay
 * pending and the bucket for the ones that leave.
 */
describe('machineRejectionKind', () => {
  it('keeps a real grant pending (a human approves it)', () => {
    expect(machineRejectionKind({ isGrant: true })).toBeNull()
    // isGrant wins even if a lower flag is noisily set.
    expect(machineRejectionKind({ isGrant: true, isAnnouncement: true })).toBeNull()
  })

  it('keeps an aggregator pending (a human routes it to a source)', () => {
    expect(machineRejectionKind({ isGrant: false, isAggregator: true })).toBeNull()
  })

  it('suppresses a page merely about a grant as an announcement', () => {
    expect(machineRejectionKind({ isGrant: false, isAnnouncement: true })).toBe('announcement')
  })

  it('suppresses anything else the classifier rejected as not_a_grant', () => {
    expect(machineRejectionKind({ isGrant: false })).toBe('not_a_grant')
    expect(machineRejectionKind({ isGrant: false, isAnnouncement: false, isAggregator: false })).toBe(
      'not_a_grant',
    )
  })

  it('never returns a kind that is not a real GRANT_REJECTION_KIND', () => {
    const cases: GrantClassification[] = [
      { isGrant: true },
      { isGrant: false, isAggregator: true },
      { isGrant: false, isAnnouncement: true },
      { isGrant: false },
    ]
    for (const cls of cases) {
      const kind = machineRejectionKind(cls)
      if (kind !== null) expect(['announcement', 'not_a_grant']).toContain(kind)
    }
  })
})

/**
 * The deterministic page-shape gate feeds the same rule. An index of grants is
 * a source to crawl and stays pending; a bill or a press office page is a
 * rejection and leaves the queue. This is the seam that fixes the clogged queue
 * without a model call.
 */
describe('page-shape gate routes through the same verdict', () => {
  it('leaves an aggregator index pending', () => {
    const shape = detectGrantPageShape('https://socalftc.org/grants')
    expect(shape?.shape).toBe('aggregator_index')
    expect(machineRejectionKind(shapeClassification(shape!))).toBeNull()
  })

  it('suppresses a legislative or press page', () => {
    const shape = detectGrantPageShape('https://www.congress.gov/bill/118th-congress/house-bill/1234')
    expect(shape?.shape).toBe('legislative_or_press')
    expect(machineRejectionKind(shapeClassification(shape!))).toBe('announcement')
  })
})
