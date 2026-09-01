import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { toolVotes } from '@the-tool-pit/db'
import { currentVoterFingerprint } from './fingerprint'

/**
 * Move the votes cast from this browser onto the account that just signed in.
 *
 * Voting has always been open to a signed-out visitor, and the vote was keyed
 * to an httpOnly cookie. That is right for someone with no account and wrong
 * the moment they get one: the upvotes they cast five minutes ago belonged to a
 * browser, so signing in made them somebody else's, and signing in on a second
 * browser showed none of them.
 *
 * Called at sign-in, once. Cheap: one UPDATE over the rows carrying this
 * fingerprint, and a visitor who has never voted matches nothing.
 *
 * Never throws. A failed claim must not stop someone signing in, and the worst
 * case is the votes stay anonymous, which is where they already were.
 */
export async function claimAnonymousVotes(userId: string): Promise<number> {
  try {
    const fingerprint = await currentVoterFingerprint()
    if (!fingerprint) return 0

    const db = getDb()

    // Tools this account already voted for from some other browser. Those rows
    // stay, and the anonymous duplicate is dropped rather than adopted: the
    // partial unique index would reject the second row anyway, and an account
    // holding two votes for one tool is exactly the double count the index
    // exists to stop.
    const alreadyMine = await db
      .select({ toolId: toolVotes.toolId })
      .from(toolVotes)
      .where(eq(toolVotes.userId, userId))
    const mine = alreadyMine.map((r) => r.toolId)

    if (mine.length > 0) {
      await db
        .delete(toolVotes)
        .where(
          and(
            eq(toolVotes.voterFingerprint, fingerprint),
            isNull(toolVotes.userId),
            sql`${toolVotes.toolId} in (${sql.join(
              mine.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`,
          ),
        )
    }

    const claimed = await db
      .update(toolVotes)
      .set({ userId })
      .where(and(eq(toolVotes.voterFingerprint, fingerprint), isNull(toolVotes.userId)))
      .returning({ id: toolVotes.id })

    return claimed.length
  } catch (err) {
    console.warn('[votes] could not claim anonymous votes:', err)
    return 0
  }
}
