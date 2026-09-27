/**
 * The daily grant digest.
 *
 * 2026-09-27: a new team profile's first sweep queued one row per grant that
 * already fit it, and the drain sent one email per row, so one mentor got 35
 * emails in a few minutes. These tests pin the replacement: one email per user
 * per day, the 13:00 UTC gate, and the failure arithmetic, all without a DB.
 */
import { describe, it, expect } from 'bun:test'
import { renderGrantDigestEmail } from '@the-tool-pit/types'
import {
  DIGEST_MIN_GAP_MS,
  MAX_ATTEMPTS,
  digestWindowOpen,
  groupByUser,
  planDigest,
  planDigestFailure,
  type DigestRow,
} from '../src/grants/digest.js'

const NOW = new Date('2026-09-28T13:02:00Z')
const DAY = 86_400_000
const PREFS = 'https://frc.tools/me/notifications'
const MORE = 'https://frc.tools/grants'

let seq = 0
function newMatch(userId: string, teamLabel: string | null, extra: Record<string, unknown> = {}): DigestRow {
  seq++
  return {
    id: `r${seq}`,
    userId,
    kind: 'new_match',
    attempts: 0,
    payload: {
      grantName: `Grant ${seq}`,
      grantUrl: `https://frc.tools/grants/grant-${seq}`,
      funderName: `Funder ${seq}`,
      teamLabel,
      verdict: 'eligible',
      awardMin: 1000,
      awardMax: 5000,
      ...extra,
    },
  }
}

function deadline(userId: string, inDays: number, teamLabel: string | null = null, attempts = 0): DigestRow {
  seq++
  return {
    id: `r${seq}`,
    userId,
    kind: 'deadline',
    attempts,
    payload: {
      grantName: `Deadline grant ${seq}`,
      grantUrl: `https://frc.tools/grants/deadline-${seq}`,
      funderName: 'Some Foundation',
      deadlineAt: new Date(NOW.getTime() + inDays * DAY).toISOString(),
      daysBefore: 7,
      teamLabel,
    },
  }
}

function render(rows: DigestRow[]) {
  const plan = planDigest(rows, NOW)
  return { plan, body: renderGrantDigestEmail({ groups: plan.groups, now: NOW, moreUrl: MORE, preferencesUrl: PREFS, unsubscribeUrl: 'https://frc.tools/unsubscribe?email=a&token=b' }) }
}

describe('grouping', () => {
  it('35 new matches for one user are one email with 10 listed and "and 25 more"', () => {
    const rows = Array.from({ length: 35 }, () => newMatch('u1', 'FRC team 3476'))
    const byUser = groupByUser(rows)
    expect(byUser.size).toBe(1)

    const { plan, body } = render(byUser.get('u1')!)
    expect(plan.include).toHaveLength(35)
    expect(body.subject).toBe('Grants for FRC team 3476: 35 new')
    const listed = body.text.split('\n').filter((l) => l.startsWith('- '))
    expect(listed).toHaveLength(10)
    expect(body.text).toContain(`and 25 more: ${MORE}`)
    expect(body.html).toContain('and 25 more')
    expect(body.html).toContain('Unsubscribe from everything')
  })

  it('splits users apart', () => {
    const byUser = groupByUser([newMatch('a', null), newMatch('b', null), newMatch('a', null)])
    expect(byUser.get('a')).toHaveLength(2)
    expect(byUser.get('b')).toHaveLength(1)
  })

  it('lists closing soon first, soonest first, then new matches', () => {
    const late = deadline('u1', 9, 'FRC team 3476')
    const soon = deadline('u1', 2, 'FRC team 3476')
    const { body } = render([newMatch('u1', 'FRC team 3476'), late, soon])
    expect(body.subject).toBe('Grants for FRC team 3476: 1 new, 2 closing soon')
    const t = body.text
    expect(t.indexOf('CLOSING SOON')).toBeLessThan(t.indexOf('NEW MATCHES'))
    const s = (soon.payload as { grantName: string }).grantName
    const l = (late.payload as { grantName: string }).grantName
    expect(t.indexOf(s)).toBeLessThan(t.indexOf(l))
    expect(t).toContain('2 days left')
  })

  it('folds a watched-grant reminder into the only team', () => {
    const { plan } = render([newMatch('u1', 'FRC team 3476'), deadline('u1', 3, null)])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]!.closingSoon).toHaveLength(1)
  })

  it('groups by team when the user is on several profiles', () => {
    const rows = [
      newMatch('u1', 'FRC team 3476'),
      newMatch('u1', 'FTC team 12345'),
      deadline('u1', 4, 'FTC team 12345'),
      newMatch('u1', 'FRC team 3476'),
    ]
    const { plan, body } = render(rows)
    expect(plan.groups.map((g) => g.teamLabel)).toEqual(['FRC team 3476', 'FTC team 12345'])
    expect(plan.groups[0]!.newMatches).toHaveLength(2)
    expect(body.subject).toBe('Grants for FRC team 3476 and FTC team 12345: 3 new, 1 closing soon')
    expect(body.text.indexOf('FRC TEAM 3476')).toBeLessThan(body.text.indexOf('FTC TEAM 12345'))
  })
})

describe('window gating', () => {
  it('sends nothing before 13:00 UTC', () => {
    expect(digestWindowOpen(new Date('2026-09-28T12:59:00Z'), null)).toBe(false)
    expect(digestWindowOpen(new Date('2026-09-28T03:00:00Z'), null)).toBe(false)
  })

  it('opens at 13:00 UTC for a user with no digest yet', () => {
    expect(digestWindowOpen(new Date('2026-09-28T13:00:00Z'), null)).toBe(true)
  })

  it('holds a user who had a digest 5 hours ago', () => {
    const now = new Date('2026-09-28T18:00:00Z')
    expect(digestWindowOpen(now, new Date(now.getTime() - 5 * 3_600_000))).toBe(false)
  })

  it("sends at today's window after yesterday's 13:04 digest", () => {
    const now = new Date('2026-09-28T13:00:00Z')
    expect(digestWindowOpen(now, new Date('2026-09-27T13:04:00Z'))).toBe(true)
    expect(digestWindowOpen(now, new Date(now.getTime() - DIGEST_MIN_GAP_MS + 1))).toBe(false)
  })
})

describe('passed deadlines', () => {
  it('drops a deadline row whose date passed before the digest', () => {
    const gone = deadline('u1', -0.5)
    const live = deadline('u1', 3)
    const { plan, body } = render([gone, live, newMatch('u1', null)])
    expect(plan.passed.map((r) => r.id)).toEqual([gone.id])
    expect(plan.include.map((r) => r.id)).not.toContain(gone.id)
    expect(body.text).not.toContain((gone.payload as { grantName: string }).grantName)
    expect(body.subject).toBe('Grants: 1 new, 1 closing soon')
  })

  it('parks an unusable payload instead of sending it', () => {
    const bad: DigestRow = { id: 'bad', userId: 'u1', kind: 'deadline', attempts: 0, payload: { grantName: 'x', grantUrl: 'y' } }
    const plan = planDigest([bad], NOW)
    expect(plan.unrenderable).toEqual([bad])
    expect(plan.include).toEqual([])
  })
})

describe('send failure', () => {
  it('bumps attempts on every row the email carried', () => {
    const rows = [newMatch('u1', null), deadline('u1', 3, null, 2), deadline('u1', 5, null, MAX_ATTEMPTS - 1)]
    const updates = planDigestFailure(rows, { retryable: true, error: '429' }, NOW)
    expect(updates.map((u) => u.id)).toEqual(rows.map((r) => r.id))
    expect(updates.map((u) => u.attempts)).toEqual([1, 3, MAX_ATTEMPTS])
    expect(updates.map((u) => u.park)).toEqual([null, null, 'attempts'])
    const first = updates[0]!
    expect(first.park === null && first.sendAfter.getTime() > NOW.getTime()).toBe(true)
  })

  it('parks every row on a permanent failure', () => {
    const rows = [newMatch('u1', null), newMatch('u1', null)]
    const updates = planDigestFailure(rows, { retryable: false, error: 'bad key' }, NOW)
    expect(updates.every((u) => u.park === 'transport' && u.attempts >= MAX_ATTEMPTS)).toBe(true)
  })
})
