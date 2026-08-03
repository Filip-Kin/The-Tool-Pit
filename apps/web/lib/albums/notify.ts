/**
 * Discord notification for new public album submissions. Best-effort: never
 * throws, never blocks the submission. The webhook URL is an env var
 * (PHOTO_SUBMISSION_DISCORD_WEBHOOK); if unset, notifications are skipped.
 */
interface SubmissionNotice {
  url: string
  eventHint?: string
  photographer?: string
  note?: string
}

export async function notifyNewSubmission(s: SubmissionNotice): Promise<void> {
  const webhook = process.env.PHOTO_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return
  const adminUrl = 'https://photos.frc.tools/admin/album-candidates?status=submitted'
  const fields = [
    { name: 'Album URL', value: s.url.slice(0, 1000) },
    s.eventHint ? { name: 'Event hint', value: s.eventHint.slice(0, 200) } : null,
    s.photographer ? { name: 'Photographer', value: s.photographer.slice(0, 200) } : null,
    s.note ? { name: 'Note', value: s.note.slice(0, 500) } : null,
  ].filter(Boolean)

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: 'New photo album submission',
            url: s.url,
            description: `Review it in the [admin queue](${adminUrl}).`,
            color: 0x7c3aed,
            fields,
          },
        ],
      }),
    })
  } catch {
    // ignore - notification failure must never affect the submission
  }
}
