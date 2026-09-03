/**
 * The write side of notification_outbox.
 *
 * It lives in packages/db rather than in either app because BOTH write to it:
 * apps/web queues from the admin approval actions, apps/worker queues from the
 * automatic publish path in the pipeline. A copy in each would be the same
 * mistake the grant email templates already made once.
 *
 * The drain side is apps/worker/src/notifications/outbox.ts. Nothing else
 * sends these emails, and nothing calls the mail transport directly.
 */
import { getDb } from './client'
import { notificationOutbox, type NewNotificationOutboxRow, type NotificationSubject } from './schema/notifications'

// #region dedupe

/**
 * The idempotency key for one outcome.
 *
 * `<kind>:<subjectId>:<userId>`, and the unique index on dedupe_key is what
 * turns a second click on Approve, a replayed server action, or an unpublish
 * followed by a re-publish into one email rather than several.
 *
 * The kind is in the key on purpose: approving a claim and later rejecting it
 * are two different outcomes about the same claim, and the person should hear
 * about both.
 */
export function notificationDedupeKey(kind: string, subjectId: string, userId: string): string {
  return `${kind}:${subjectId}:${userId}`
}

// #endregion

// #region write

/**
 * The narrow slice of the drizzle client this module uses.
 *
 * Spelled out rather than inferred so a test can hand in a fake and check the
 * conflict clause without a database. The row itself is still typed as
 * NewNotificationOutboxRow, so a wrong column is still a compile error.
 */
export interface NotificationWriter {
  insert(table: typeof notificationOutbox): {
    values(row: NewNotificationOutboxRow): {
      onConflictDoNothing(config: { target: unknown }): {
        returning(columns: { id: unknown }): Promise<Array<{ id: string }>>
      }
    }
  }
}

export interface QueueNotificationInput {
  /**
   * Who to tell, when they have an account. Null or undefined means an
   * anonymous submission, and for the moderation kinds that is the normal case,
   * not an error: with no user AND no recipientEmail nothing is written and
   * null comes back.
   */
  userId: string | null | undefined
  /**
   * A raw address to deliver to instead, for a recipient with no account.
   *
   * The ONLY supported use is reaching a scraped public contact (listing
   * outreach): there is no user to point at and the address is the recipient.
   * Pass a dedupeKey with it, because the default key is built from the user
   * id. When both userId and recipientEmail are given, userId wins and this is
   * ignored, so a caller cannot accidentally fan a moderation outcome out to a
   * raw address.
   */
  recipientEmail?: string | null
  /** APPROVAL_EMAIL_KINDS in @the-tool-pit/types, e.g. 'field_published'. */
  kind: string
  /** What sort of thing this is about, for the admin looking at the outbox. */
  subjectType: NotificationSubject
  /** Its id in its own table. Also the middle of the default dedupe key. */
  subjectId: string
  /** Override the default key. Only when kind + subject + user is not unique. */
  dedupeKey?: string
  /** Everything the body needs. See ApprovalEmailPayload in @the-tool-pit/types. */
  payload: Record<string, unknown>
  /** Earliest send time. Defaults to now. */
  sendAfter?: Date
}

/**
 * Queue one notification. Returns the new row id, null when there was nobody
 * to tell, and null when the dedupe key already existed.
 *
 * NEVER THROWS, and that is the point of the function.
 *
 * Every caller is a moderation action that has already done the thing that
 * matters: the field is published, the claim is settled, the tool is in the
 * directory. Letting a notification failure propagate would turn a working
 * approval into an error message on an admin's screen. So a failure here is
 * logged with the kind and the subject id and swallowed. The row is missing,
 * the approval stands, and the log says which one to requeue.
 *
 * `db` is injectable so the idempotency behaviour can be tested without a
 * database. Production callers pass nothing.
 */
export async function queueNotification(
  input: QueueNotificationInput,
  db: NotificationWriter = getDb() as unknown as NotificationWriter,
): Promise<string | null> {
  // userId wins; a raw address is only for a recipient with no account.
  const userId = input.userId ?? null
  const recipientEmail = userId ? null : (input.recipientEmail?.trim() || null)

  // No account AND no raw address: an anonymous submission. Correctly nothing.
  if (!userId && !recipientEmail) return null

  // The default key needs a stable third part. It is the user id when there is
  // one, and the address otherwise, so two clicks on the same outreach collapse
  // to one row exactly the way two Approve clicks do.
  const dedupeKey =
    input.dedupeKey ?? notificationDedupeKey(input.kind, input.subjectId, userId ?? recipientEmail ?? '')

  try {
    const [row] = await db
      .insert(notificationOutbox)
      .values({
        userId,
        recipientEmail,
        kind: input.kind,
        channel: 'email',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: input.payload,
        dedupeKey,
        sendAfter: input.sendAfter ?? new Date(),
      })
      .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
      .returning({ id: notificationOutbox.id })

    return row?.id ?? null
  } catch (err) {
    console.error(
      `[notify] could not queue ${input.kind} for ${input.subjectType} ${input.subjectId}: ${(err as Error).message}`,
    )
    return null
  }
}

// #endregion
