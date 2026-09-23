import { describe, expect, it } from 'vitest'
import { MAX_QUEUE_DECISIONS, parseQueueRequest, publishFormExtras } from '@/lib/admin/queue-decisions'

const actor = { name: 'review-bot' }

describe('parseQueueRequest', () => {
  it('accepts every decision shape', () => {
    const out = parseQueueRequest({
      actor,
      decisions: [
        { kind: 'album', id: 'a1', action: 'approve', eventKey: '2026miket' },
        { kind: 'album', id: 'a2', action: 'suppress' },
        { kind: 'grant', id: 'g1', action: 'suppress', reason: 'Award announcement', rejectionKind: 'award_news' },
        { kind: 'grant', id: 'g2', action: 'flag', note: 'No deadline read' },
        { kind: 'grant', id: 'g3', action: 'duplicate' },
        { kind: 'grant', id: 'g4', action: 'route' },
        { kind: 'grant', id: 'g5', action: 'attach', grantRef: 'some-grant' },
        { kind: 'grant', id: 'g6', action: 'publish', overrides: { programs: 'frc,ftc' }, status: 'pending' },
      ],
    })
    expect('error' in out).toBe(false)
    if (!('error' in out)) expect(out.decisions).toHaveLength(8)
  })

  it('rejects a missing actor, a missing field, and an unknown action', () => {
    expect(parseQueueRequest({ decisions: [] })).toEqual({ error: 'actor.name is required.' })
    expect(parseQueueRequest({ actor, decisions: [{ kind: 'grant', id: 'g', action: 'suppress' }] })).toHaveProperty('error')
    expect(parseQueueRequest({ actor, decisions: [{ kind: 'album', id: 'a', action: 'approve' }] })).toHaveProperty('error')
    expect(parseQueueRequest({ actor, decisions: [{ kind: 'grant', id: 'g', action: 'delete' }] })).toHaveProperty('error')
  })

  it('keeps the gate bypass out of overrides', () => {
    const out = parseQueueRequest({
      actor,
      decisions: [{ kind: 'grant', id: 'g', action: 'publish', overrides: { overrideVerification: 'x' } }],
    })
    expect(out).toHaveProperty('error')
  })

  it('caps the batch', () => {
    const decisions = Array.from({ length: MAX_QUEUE_DECISIONS + 1 }, (_, i) => ({ kind: 'grant', id: `g${i}`, action: 'route' }))
    expect(parseQueueRequest({ actor, decisions })).toHaveProperty('error')
  })
})

describe('publishFormExtras', () => {
  it('defaults to published, splits programs, and passes the named override', () => {
    const { extra, programs } = publishFormExtras({
      kind: 'grant',
      id: 'g',
      action: 'publish',
      overrides: { programs: 'frc, ftc,', name: 'Better name' },
      overrideVerification: 'Checked the PDF',
    })
    expect(extra).toEqual({ status: 'published', name: 'Better name', overrideVerification: 'Checked the PDF' })
    expect(programs).toEqual(['frc', 'ftc'])
  })
})
