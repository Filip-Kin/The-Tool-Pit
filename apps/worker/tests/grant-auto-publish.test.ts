import { describe, it, expect } from 'vitest'
import { shouldAutoPublish, blockedReviewNote, type AutoPublishCandidate } from '../src/grants/auto-publish.js'
import { readPublishResult } from '../src/site/queue-decisions.js'
import type { GrantExtraction } from '@the-tool-pit/db'

function extraction(over: Partial<GrantExtraction> = {}): GrantExtraction {
  return {
    version: 1,
    fields: {} as GrantExtraction['fields'],
    depth: 'shallow',
    evidenceUrls: [],
    notes: [],
    extractedAt: '2026-09-23T00:00:00Z',
    applyRoute: { status: 'portal', url: 'https://x.submittable.com/submit/1', email: null, evidence: 'button', chain: [], checkedAt: '' },
    deadlineProof: { kind: 'dated', date: '2026-11-01', urlsRead: [], checkedAt: '' },
    fit: { level: 'robotics', reason: 'FIRST teams', model: 'm', checkedAt: '' },
    ...over,
  }
}

function candidate(over: Partial<AutoPublishCandidate> = {}): AutoPublishCandidate {
  return {
    status: 'pending',
    matchedGrantId: null,
    classification: { isGrant: true, confidence: 0.9 },
    confidenceScore: 0.9,
    extraction: extraction(),
    ...over,
  }
}

describe('shouldAutoPublish', () => {
  it('asks for a confident, verified, fitting grant', () => {
    expect(shouldAutoPublish(candidate())).toEqual({ ok: true })
  })

  it('accepts every fit level except off', () => {
    for (const level of ['robotics', 'stem', 'general'] as const) {
      expect(shouldAutoPublish(candidate({ extraction: extraction({ fit: { level, reason: '', model: '', checkedAt: '' } }) })).ok).toBe(true)
    }
    expect(shouldAutoPublish(candidate({ extraction: extraction({ fit: { level: 'off', reason: 'wildfire relief', model: '', checkedAt: '' } }) }))).toEqual({ ok: false, reason: 'fit is off' })
    expect(shouldAutoPublish(candidate({ extraction: extraction({ fit: undefined }) })).ok).toBe(false)
  })

  it('accepts portal, form and email routes', () => {
    for (const status of ['portal', 'form', 'email']) {
      const route = { status, url: null, email: null, evidence: '', chain: [], checkedAt: '' }
      expect(shouldAutoPublish(candidate({ extraction: extraction({ applyRoute: route }) })).ok).toBe(true)
    }
  })

  it('refuses a walled, unknown or missing route', () => {
    for (const status of ['walled', 'unverified', 'none']) {
      const route = { status, url: null, email: null, evidence: '', chain: [], checkedAt: '' }
      expect(shouldAutoPublish(candidate({ extraction: extraction({ applyRoute: route }) })).ok).toBe(false)
    }
    expect(shouldAutoPublish(candidate({ extraction: extraction({ applyRoute: undefined }) })).ok).toBe(false)
  })

  it('takes a closed route only with timing on record', () => {
    const closed = { status: 'closed', url: 'https://f.org/apply', email: null, evidence: 'not accepting', chain: [], checkedAt: '' }
    expect(shouldAutoPublish(candidate({ extraction: extraction({ applyRoute: closed, deadlineProof: { kind: 'not_public', urlsRead: [], checkedAt: '' } }) })).ok).toBe(true)
    expect(shouldAutoPublish(candidate({ extraction: extraction({ applyRoute: closed, deadlineProof: { kind: 'none', urlsRead: [], checkedAt: '' } }) })).ok).toBe(false)
    expect(shouldAutoPublish(candidate({ extraction: extraction({ applyRoute: closed, deadlineProof: undefined }) })).ok).toBe(false)
  })

  it('needs classifier confidence of at least 0.8 on a pending row', () => {
    expect(shouldAutoPublish(candidate({ classification: { isGrant: true, confidence: 0.8 } })).ok).toBe(true)
    expect(shouldAutoPublish(candidate({ classification: { isGrant: true, confidence: 0.79 } })).ok).toBe(false)
  })

  it('needs the classifier to have accepted a pending row as a grant', () => {
    expect(shouldAutoPublish(candidate({ classification: null })).ok).toBe(false)
    expect(shouldAutoPublish(candidate({ classification: { isGrant: false, confidence: 0.95 } })).ok).toBe(false)
    expect(shouldAutoPublish(candidate({ classification: { isGrant: true, isAggregator: true, confidence: 0.95 } })).ok).toBe(false)
    expect(shouldAutoPublish(candidate({ classification: { isGrant: true, isAnnouncement: true, confidence: 0.95 } })).ok).toBe(false)
  })

  it('treats a flagged row as accepted, whatever the classifier said', () => {
    expect(shouldAutoPublish(candidate({ status: 'flagged', classification: { isAggregator: true, confidence: 0.3 } })).ok).toBe(true)
    expect(shouldAutoPublish(candidate({ status: 'flagged', classification: null, confidenceScore: null })).ok).toBe(true)
    // The extraction checks still apply.
    expect(shouldAutoPublish(candidate({ status: 'flagged', extraction: null })).ok).toBe(false)
  })

  it('leaves decided and attached rows alone', () => {
    for (const status of ['published', 'suppressed', 'duplicate', 'matched']) {
      expect(shouldAutoPublish(candidate({ status })).ok).toBe(false)
    }
    expect(shouldAutoPublish(candidate({ matchedGrantId: '7f1c0000-0000-0000-0000-000000000000' })).ok).toBe(false)
  })
})

describe('blockedReviewNote', () => {
  const error = 'the application link has not been verified (no apply-route check on the extraction)'

  it('writes the refusal verbatim on a pending row', () => {
    expect(blockedReviewNote('pending', 'stale note', error)).toBe(`Auto-publish blocked: ${error}`)
  })

  it('keeps a flagged note and appends the refusal once', () => {
    const once = blockedReviewNote('flagged', 'deadline is wrong', error)
    expect(once).toBe(`deadline is wrong\nAuto-publish blocked: ${error}`)
    expect(blockedReviewNote('flagged', once, error)).toBe(once)
  })

  it('writes the refusal on a flagged row with no note', () => {
    expect(blockedReviewNote('flagged', null, error)).toBe(`Auto-publish blocked: ${error}`)
  })
})

describe('readPublishResult', () => {
  const id = 'c1'

  it('reads a publish', () => {
    expect(readPublishResult(true, 200, { results: [{ id, ok: true, slug: 'john-deere-first-team' }] }, id)).toEqual({ status: 'published', slug: 'john-deere-first-team' })
  })

  it('counts a refused cycle with a slug as published', () => {
    const error = 'Grant saved, but the cycle was not: no year. Add it in the editor.'
    expect(readPublishResult(true, 200, { results: [{ id, ok: false, error, slug: 'x' }] }, id)).toEqual({ status: 'published_no_cycle', slug: 'x', error })
  })

  it('passes a gate refusal through verbatim', () => {
    const error = 'this is the same programme as "X" (/grants/x, published)'
    expect(readPublishResult(true, 200, { results: [{ id, ok: false, error }] }, id)).toEqual({ status: 'refused', error })
  })

  it('treats HTTP and shape errors as no decision', () => {
    expect(readPublishResult(false, 404, { error: 'Not found' }, id)).toEqual({ status: 'unavailable', error: 'Not found' })
    expect(readPublishResult(false, 502, {}, id)).toEqual({ status: 'unavailable', error: 'HTTP 502' })
    expect(readPublishResult(true, 200, { results: [] }, id).status).toBe('unavailable')
  })
})
