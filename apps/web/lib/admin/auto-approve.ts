import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { users, type User } from '@the-tool-pit/db'

/**
 * An admin's own submission does not wait in a queue. Every public submit
 * path asks this one question after it writes its pending row: is the person
 * who sent it an admin? If so the path runs the same code the admin's Accept
 * button runs, stamps them as the verifier, and sends no Discord notice.
 *
 * Never true for anyone else. A blocked account is not an admin here even if
 * the flag is still set on the row.
 */
export async function adminSubmitter(userId: string | null | undefined): Promise<User | null> {
  if (!userId) return null
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || !user.isAdmin || user.blockedReason) return null
  return user
}
