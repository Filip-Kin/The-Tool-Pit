'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { userTeams, FIELD_PROGRAMS, TEAM_MEMBER_ROLES } from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * Team membership, self-asserted.
 *
 * Nothing here is checked against The Blue Alliance. Claiming a team only
 * changes what that one user sees (which grants get matched, which events get
 * surfaced), so a wrong number costs the person who typed it and nobody else.
 * The moment membership grants any authority over shared data, this needs a
 * real ownership check first, which is what accounts.userTeams.verified is
 * reserved for.
 */

/**
 * A sanity bound, not a validity check. FRC numbers are four to five digits
 * today, so anything past this is a typo or someone probing the form. Rejecting
 * it here keeps the column honest without pretending we know which numbers are
 * real.
 */
const MAX_TEAM_NUMBER = 99_999

/**
 * How many teams one account may claim. A mentor across a few programs is
 * plausible, a hundred is not. Bounded on purpose and reported to the user
 * rather than silently ignoring the insert.
 */
const MAX_TEAMS_PER_USER = 20

export async function addTeam(formData: FormData): Promise<{ error?: string }> {
  const user = await getCurrentUser()
  // Not a redirect: the caller is a client component mid-transition, and a
  // message it can render beats an error boundary.
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }

  const program = String(formData.get('program') ?? '')
  const role = String(formData.get('role') ?? '')
  const rawNumber = String(formData.get('teamNumber') ?? '').trim()

  if (!(FIELD_PROGRAMS as readonly string[]).includes(program)) {
    return { error: 'Pick a program.' }
  }
  if (!(TEAM_MEMBER_ROLES as readonly string[]).includes(role)) {
    return { error: 'Pick a role.' }
  }

  // Number() would accept '12e3', ' 12 ' and '0x10'. Match the digits instead
  // so what the user typed is exactly what gets stored.
  if (!/^\d+$/.test(rawNumber)) {
    return { error: 'Team number must be a whole number, for example 3538.' }
  }
  const teamNumber = Number(rawNumber)
  if (teamNumber < 1 || teamNumber > MAX_TEAM_NUMBER) {
    return { error: `Team number must be between 1 and ${MAX_TEAM_NUMBER}.` }
  }

  const db = getDb()
  const existing = await db
    .select({ id: userTeams.id })
    .from(userTeams)
    .where(eq(userTeams.userId, user.id))
  if (existing.length >= MAX_TEAMS_PER_USER) {
    return { error: `You can claim up to ${MAX_TEAMS_PER_USER} teams. Remove one first.` }
  }

  // Claiming the same team twice is not an error, it is a role change: the
  // unique index is (userId, program, teamNumber), so update the role in place.
  // `verified` is deliberately untouched, so re-adding a team cannot clear a
  // verification someone else granted.
  await db
    .insert(userTeams)
    .values({ userId: user.id, program, teamNumber, role })
    .onConflictDoUpdate({
      target: [userTeams.userId, userTeams.program, userTeams.teamNumber],
      set: { role },
    })

  revalidateMe()
  return {}
}

export async function removeTeam(id: string): Promise<{ error?: string }> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }

  const db = getDb()
  // Scoped to the signed-in user, so a guessed row id from another account
  // deletes nothing.
  const deleted = await db
    .delete(userTeams)
    .where(and(eq(userTeams.id, id), eq(userTeams.userId, user.id)))
    .returning({ id: userTeams.id })
  if (deleted.length === 0) return { error: 'That team was already removed.' }

  revalidateMe()
  return {}
}

/** /me and /me/team both read userTeams, so both go stale on every write. */
function revalidateMe() {
  revalidatePath('/me')
  revalidatePath('/me/team')
}
