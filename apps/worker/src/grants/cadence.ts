/**
 * How often to re-check a grant, and which grants are due right now.
 *
 * The monitor exists to catch a deadline moving while the move still matters.
 * A funder that shifts its closing date from 1 March to 15 February is only a
 * useful thing to know if we notice before 15 February, so the cadence is
 * driven by the distance to the next deadline and by nothing else. Checking
 * every grant daily would be honest but wasteful: most listings sit still for
 * months, and every fetch is a page load on somebody else's server.
 *
 * The tiers are deliberately coarse:
 *
 *   deadline within 30 days   -> 24 hours   (a change here is urgent)
 *   deadline within 90 days   -> 168 hours  (weekly is early enough to react)
 *   anything else             -> 720 hours  (monthly, just to notice it woke up)
 *
 * "Anything else" covers closed, rolling, unknown, and a deadline so far out
 * that a change to it is not yet actionable. A closed annual grant still gets
 * a monthly look, because the whole point of keeping closed cycles is to spot
 * the day next year's window opens.
 */
import { eq, inArray } from 'drizzle-orm'
import { getDb, grants, grantCycles } from '@the-tool-pit/db'
import type { Grant, GrantCycle, GrantCycleStatus } from '@the-tool-pit/db'

// #region cadence

/** Deadline is close enough that a change needs to be seen the same day. */
export const CADENCE_NEAR_HOURS = 24
/** Deadline is in sight. Weekly still leaves time to act on a change. */
export const CADENCE_SOON_HOURS = 168
/** Closed, rolling, unknown, or far away. Monthly. */
export const CADENCE_IDLE_HOURS = 720

const NEAR_DAYS = 30
const SOON_DAYS = 90

const MS_PER_DAY = 86_400_000

/**
 * The cadence for one grant, in hours, from its next cycle.
 *
 * `nextCycle` is the cycle a team would actually be working towards, which is
 * what pickNextCycle returns. Pass null when the grant has no cycles at all.
 *
 * An ESTIMATED cycle is treated exactly like a published one on purpose. The
 * weeks around a carried-over date are precisely when the funder replaces it
 * with the real one, so that is when we most want to be looking at the page.
 */
export function computeCheckCadenceHours(
  grant: Pick<Grant, 'deadlineType'>,
  nextCycle: Pick<GrantCycle, 'deadlineAt' | 'status'> | null | undefined,
  now: Date = new Date(),
): number {
  // A rolling grant has no closing date to move, so there is nothing for a
  // tighter cadence to catch.
  if (grant.deadlineType === 'rolling') return CADENCE_IDLE_HOURS

  if (!nextCycle) return CADENCE_IDLE_HOURS
  if (nextCycle.status === 'closed') return CADENCE_IDLE_HOURS
  if (!nextCycle.deadlineAt) return CADENCE_IDLE_HOURS

  const days = (nextCycle.deadlineAt.getTime() - now.getTime()) / MS_PER_DAY

  // A deadline already in the past on a cycle nobody has marked closed yet.
  // Nothing urgent left to catch, and the monthly pass will pick up next
  // year's dates when they appear.
  if (days < 0) return CADENCE_IDLE_HOURS

  if (days <= NEAR_DAYS) return CADENCE_NEAR_HOURS
  if (days <= SOON_DAYS) return CADENCE_SOON_HOURS
  return CADENCE_IDLE_HOURS
}

/**
 * The cycle scheduling should aim at: the soonest deadline still ahead of us,
 * and failing that the most recent cycle on record.
 *
 * The matcher has its own cycle picker with a different job (which cycle to
 * show a team), so this one stays here rather than being shared. Scheduling
 * wants the next thing to happen even when its status has not been updated
 * yet; matching wants a cycle a team can actually apply to.
 */
export function pickNextCycle(cycles: GrantCycle[], now: Date = new Date()): GrantCycle | null {
  if (cycles.length === 0) return null

  const future = cycles
    .filter((c) => c.deadlineAt !== null && c.deadlineAt.getTime() >= now.getTime())
    .sort((a, b) => a.deadlineAt!.getTime() - b.deadlineAt!.getTime())
  if (future.length > 0) return future[0]

  return [...cycles].sort((a, b) => b.cycleYear - a.cycleYear)[0]
}

/**
 * Cycle status from its dates. Derived, never typed by hand, so a cycle cannot
 * sit at 'open' for a year after it shut.
 *
 * 'unknown' when there is no deadline at all: an open window with no closing
 * date is a claim we cannot support from the page.
 */
export function deriveCycleStatus(
  opensAt: string | Date | null | undefined,
  deadlineAt: Date | null | undefined,
  now: Date = new Date(),
): GrantCycleStatus {
  if (deadlineAt && deadlineAt.getTime() < now.getTime()) return 'closed'

  if (opensAt) {
    // grant_cycles.opens_at is a DATE column, so drizzle hands back
    // 'YYYY-MM-DD'. Parse as UTC midnight; a one-day error on an opening date
    // is not worth carrying a timezone for.
    const opens = opensAt instanceof Date ? opensAt : new Date(`${opensAt}T00:00:00Z`)
    if (!Number.isNaN(opens.getTime()) && opens.getTime() > now.getTime()) return 'upcoming'
  }

  if (deadlineAt) return 'open'
  return 'unknown'
}

// #endregion

// #region due selection

/**
 * Safety valve on one scheduler tick. This is a cap on how many pages we will
 * queue at once, not a cap on coverage: anything left over is still due on the
 * next tick. It is logged when it bites, because a number nobody sees reads as
 * "we checked everything" when we did not.
 */
const DEFAULT_BATCH_LIMIT = 500

export interface DueGrantOptions {
  /** Most ids to return in one tick. Defaults to 500. */
  limit?: number
  now?: Date
}

/**
 * Recompute cadences, then return the ids of published grants that are due for
 * a monitor pass. The caller enqueues them; this function deliberately does no
 * enqueueing of its own so it stays testable and so queue wiring lives in one
 * place.
 *
 * The cadence recompute has to happen here. checkCadenceHours is a stored
 * number, and the thing it depends on (days until the deadline) changes every
 * single day without anyone writing to the row. Left alone, a grant whose
 * deadline crossed the 30-day line would keep its monthly cadence right
 * through the window that matters.
 */
export async function enqueueDueGrantMonitors(opts: DueGrantOptions = {}): Promise<string[]> {
  const db = getDb()
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? DEFAULT_BATCH_LIMIT

  const published = await db
    .select({
      id: grants.id,
      name: grants.name,
      deadlineType: grants.deadlineType,
      lastCheckedAt: grants.lastCheckedAt,
      checkCadenceHours: grants.checkCadenceHours,
    })
    .from(grants)
    .where(eq(grants.status, 'published'))

  if (published.length === 0) return []

  const cycles = await db
    .select()
    .from(grantCycles)
    .where(inArray(grantCycles.grantId, published.map((g) => g.id)))

  const cyclesByGrant = new Map<string, GrantCycle[]>()
  for (const c of cycles) {
    const list = cyclesByGrant.get(c.grantId)
    if (list) list.push(c)
    else cyclesByGrant.set(c.grantId, [c])
  }

  // Group the writes by target value so a few hundred grants cost one UPDATE
  // per distinct cadence rather than one per grant.
  const cadenceUpdates = new Map<number, string[]>()
  const due: Array<{ id: string; lastCheckedAt: Date | null }> = []

  for (const grant of published) {
    const nextCycle = pickNextCycle(cyclesByGrant.get(grant.id) ?? [], now)
    const cadence = computeCheckCadenceHours(grant, nextCycle, now)

    if (cadence !== grant.checkCadenceHours) {
      const list = cadenceUpdates.get(cadence)
      if (list) list.push(grant.id)
      else cadenceUpdates.set(cadence, [grant.id])
    }

    // Use the freshly computed cadence, not the stored one, so a grant that
    // just crossed into the 30-day window is due today rather than next month.
    const dueAt = grant.lastCheckedAt
      ? grant.lastCheckedAt.getTime() + cadence * 3_600_000
      : 0
    if (dueAt <= now.getTime()) due.push({ id: grant.id, lastCheckedAt: grant.lastCheckedAt })
  }

  for (const [cadence, ids] of cadenceUpdates) {
    await db.update(grants).set({ checkCadenceHours: cadence }).where(inArray(grants.id, ids))
  }

  // Never-checked grants first, then whichever has been waiting longest.
  due.sort((a, b) => {
    if (!a.lastCheckedAt) return b.lastCheckedAt ? -1 : 0
    if (!b.lastCheckedAt) return 1
    return a.lastCheckedAt.getTime() - b.lastCheckedAt.getTime()
  })

  const selected = due.slice(0, limit).map((g) => g.id)

  if (due.length > selected.length) {
    console.warn(
      `[grant-cadence] ${due.length} grants are due but only ${selected.length} were queued ` +
        `this tick (limit ${limit}). The remainder stay due and go out on the next tick.`,
    )
  }

  console.log(
    `[grant-cadence] published=${published.length} due=${due.length} queued=${selected.length} ` +
      `cadence_updates=${cadenceUpdates.size ? [...cadenceUpdates].map(([h, ids]) => `${h}h:${ids.length}`).join(' ') : 'none'}`,
  )

  return selected
}

// #endregion
