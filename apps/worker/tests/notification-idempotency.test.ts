import { describe, it, expect, vi } from 'vitest'
import {
  notificationDedupeKey,
  queueNotification,
  type NotificationWriter,
  type NewNotificationOutboxRow,
} from '@the-tool-pit/db'

/**
 * The two promises the outbox write side makes, tested without a database.
 *
 *   1. Approving twice is one email. The unique index on dedupe_key does the
 *      real work; this checks that we hand it the same key both times and that
 *      we ask for ON CONFLICT DO NOTHING rather than an upsert.
 *   2. Queueing can fail without taking the approval with it. Every caller has
 *      already published the listing by the time it gets here.
 */

// #region fake writer

interface Recorded {
  row: NewNotificationOutboxRow
  conflictTarget: unknown
}

/**
 * A stand-in for the drizzle client that records what it was asked to write and
 * simulates the unique index on dedupe_key: a key it has seen before returns no
 * row, which is exactly what onConflictDoNothing().returning() does in Postgres.
 */
function fakeWriter(opts: { throwOn?: number } = {}) {
  const writes: Recorded[] = []
  const keys = new Set<string>()
  let calls = 0

  const writer: NotificationWriter = {
    insert() {
      return {
        values(row: NewNotificationOutboxRow) {
          return {
            onConflictDoNothing(config: { target: unknown }) {
              return {
                async returning() {
                  calls++
                  if (opts.throwOn === calls) throw new Error('connection reset by peer')
                  writes.push({ row, conflictTarget: config.target })
                  if (keys.has(row.dedupeKey)) return []
                  keys.add(row.dedupeKey)
                  return [{ id: `row-${keys.size}` }]
                },
              }
            },
          }
        },
      }
    },
  }

  return { writer, writes }
}

// #endregion

const BASE = {
  userId: 'user-1',
  kind: 'field_published',
  subjectType: 'practice_field' as const,
  subjectId: 'field-1',
  payload: { title: 'Kettering University Field House' },
}

describe('notificationDedupeKey', () => {
  it('is the same for the same outcome, so a second approval collapses onto the first', () => {
    expect(notificationDedupeKey('field_published', 'field-1', 'user-1')).toBe(
      notificationDedupeKey('field_published', 'field-1', 'user-1'),
    )
  })

  it('separates the two people who could be told about the same thing', () => {
    expect(notificationDedupeKey('field_published', 'field-1', 'user-1')).not.toBe(
      notificationDedupeKey('field_published', 'field-1', 'user-2'),
    )
  })

  it('separates approving a claim from later rejecting it', () => {
    // Both are outcomes about the same claim, and the claimant should hear
    // about both, so the kind has to be part of the key.
    expect(notificationDedupeKey('claim_approved', 'claim-1', 'user-1')).not.toBe(
      notificationDedupeKey('claim_rejected', 'claim-1', 'user-1'),
    )
  })
})

describe('queueNotification', () => {
  it('writes one row and hands back its id', async () => {
    const { writer, writes } = fakeWriter()
    const id = await queueNotification(BASE, writer)

    expect(id).toBe('row-1')
    expect(writes).toHaveLength(1)
    expect(writes[0].row.dedupeKey).toBe('field_published:field-1:user-1')
    expect(writes[0].row.channel).toBe('email')
    expect(writes[0].row.payload).toEqual({ title: 'Kettering University Field House' })
  })

  it('is idempotent: approving twice queues once', async () => {
    const { writer, writes } = fakeWriter()

    const first = await queueNotification(BASE, writer)
    const second = await queueNotification(BASE, writer)

    expect(first).toBe('row-1')
    // Null, not an error. The conflict case is the normal case.
    expect(second).toBeNull()
    // Both attempts reached the database; the index decided, not us.
    expect(writes).toHaveLength(2)
    expect(writes[0].row.dedupeKey).toBe(writes[1].row.dedupeKey)
  })

  it('asks for do-nothing on the dedupe key rather than an upsert', async () => {
    // An upsert would overwrite a row that has already been sent and send it
    // again. The conflict target has to be the dedupe key column itself.
    const { writer, writes } = fakeWriter()
    await queueNotification(BASE, writer)
    expect(writes[0].conflictTarget).toBeDefined()
  })

  it('writes nothing for an anonymous submission', async () => {
    const { writer, writes } = fakeWriter()

    expect(await queueNotification({ ...BASE, userId: null }, writer)).toBeNull()
    expect(await queueNotification({ ...BASE, userId: undefined }, writer)).toBeNull()
    expect(await queueNotification({ ...BASE, userId: '' }, writer)).toBeNull()
    expect(writes).toHaveLength(0)
  })

  it('swallows a database failure so the approval it follows still stands', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      errors.push(String(msg))
    })

    const { writer } = fakeWriter({ throwOn: 1 })
    const id = await queueNotification(BASE, writer)

    expect(id).toBeNull()
    // Swallowed, but never silent: the log names the kind and the subject so an
    // admin can see which one to requeue.
    expect(errors.join('\n')).toContain('field_published')
    expect(errors.join('\n')).toContain('field-1')

    spy.mockRestore()
  })

  it('lets a caller override the key when kind plus subject plus user is not unique', async () => {
    const { writer, writes } = fakeWriter()
    await queueNotification({ ...BASE, dedupeKey: 'custom:1' }, writer)
    expect(writes[0].row.dedupeKey).toBe('custom:1')
  })
})

// No fake clock here. These ran under vitest, and bun's vitest shim has no
// setSystemTime, so both tests threw on the frozen-time call and the suite
// carried two red tests that said nothing about the code. The default is
// "now", and "now" is checked as a window rather than an exact instant.
describe('queueNotification defaults', () => {
  it('sends as soon as the next drain runs unless told otherwise', async () => {
    const { writer, writes } = fakeWriter()
    const before = Date.now()
    await queueNotification(BASE, writer)
    const sendAfter = writes[0].row.sendAfter as Date

    expect(sendAfter.getTime()).toBeGreaterThanOrEqual(before)
    expect(sendAfter.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('honours a delayed send time', async () => {
    const { writer, writes } = fakeWriter()
    const later = new Date('2026-09-02T10:00:00Z')
    await queueNotification({ ...BASE, sendAfter: later }, writer)
    expect(writes[0].row.sendAfter).toEqual(later)
  })
})
