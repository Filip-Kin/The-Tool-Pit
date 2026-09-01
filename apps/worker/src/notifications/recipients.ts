/**
 * One answer to "where does mail for this user go".
 *
 * Both outbox drains ask this, and they must not be able to disagree: a user
 * whose grant alerts go to a confirmed address and whose approval notices go
 * to their sign-in address would be two different mailboxes for the same
 * person, and only one of them would have been consented to.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb, notificationChannels, users } from '@the-tool-pit/db'

/**
 * Where one user's email should go, or null when we have nowhere to send.
 *
 * Order matters. A verified notification_channels row is an address the person
 * confirmed for this purpose and it wins. Failing that we fall back to the
 * account's own sign-in address, but ONLY when the identity provider says it is
 * verified: users.emailVerified is Firebase's own email_verified claim copied
 * at sign-in, so that address has been proven to belong to them. An unverified
 * address is never mailed, which is what stops a signed-in user pointing
 * somebody else's inbox at our sender.
 */
export async function resolveEmailRecipient(userId: string): Promise<string | null> {
  const db = getDb()

  const [channel] = await db
    .select({ address: notificationChannels.address })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, userId),
        eq(notificationChannels.kind, 'email'),
        eq(notificationChannels.verified, true),
        isNull(notificationChannels.disabledAt),
      ),
    )
    .orderBy(asc(notificationChannels.createdAt))
    .limit(1)
  if (channel?.address) return channel.address

  const [user] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (user?.email && user.emailVerified) return user.email

  return null
}
