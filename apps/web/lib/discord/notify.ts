import { discordApprovalMessages } from '@the-tool-pit/db'
import { sendApprovalNotice as sendShared, type ApprovalNotice } from '@the-tool-pit/types'
import { getDb } from '@/lib/db'

/**
 * The web app's door to the approvals channel. Same call as the shared one in
 * @the-tool-pit/types, plus the one thing that package cannot do: when the bot
 * posted the message and the notice names a row, remember which message is
 * about which row. That row is what turns a ✅ in Discord into a publish here,
 * and what lets Approve on the admin page edit the post.
 *
 * Every web call site imports THIS. The worker keeps importing the shared one;
 * everything it posts is a summary with no entityId, so it has nothing to
 * record.
 */
export function sendApprovalNotice(notice: ApprovalNotice): void {
  const entityId = notice.entityId?.trim()
  if (!entityId) {
    sendShared(notice)
    return
  }
  sendShared(notice, async ({ messageId, channelId }) => {
    // Never fails the post. A duplicate (vertical, entityId) means the same
    // row was announced twice; the first message keeps the reactions, the
    // second is just a message.
    try {
      await getDb()
        .insert(discordApprovalMessages)
        .values({ messageId, channelId, vertical: notice.vertical, entityId })
        .onConflictDoNothing()
    } catch (err) {
      console.error(`[discord] could not record message ${messageId} for ${notice.vertical} ${entityId}: ${(err as Error).message}`)
    }
  })
}

export type { ApprovalNotice }
