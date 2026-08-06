/**
 * Discord notification for new practice field submissions. Best-effort: never
 * throws, never blocks the submission. Webhook URL is an env var
 * (FIELD_SUBMISSION_DISCORD_WEBHOOK); if unset, notifications are skipped.
 */
interface FieldSubmissionNotice {
  name: string
  teamNumber?: number | null
  city?: string | null
  region?: string | null
  spec: string
}

export async function notifyNewFieldSubmission(s: FieldSubmissionNotice): Promise<void> {
  const webhook = process.env.FIELD_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return
  // Admin lives on the main host, not the fields subdomain (which rewrites to /fields).
  const adminUrl = 'https://ttp.filipkin.com/admin/practice-fields?status=pending'
  const location = [s.city, s.region].filter(Boolean).join(', ')
  const fields = [
    { name: 'Field', value: s.name.slice(0, 200) },
    s.teamNumber ? { name: 'Team', value: String(s.teamNumber) } : null,
    location ? { name: 'Location', value: location.slice(0, 200) } : null,
    { name: 'Spec', value: s.spec.slice(0, 200) },
  ].filter(Boolean)

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: 'New practice field submission',
            description: `Review it in the [admin queue](${adminUrl}).`,
            color: 0x6366f1,
            fields,
          },
        ],
      }),
    })
  } catch {
    // ignore - notification failure must never affect the submission
  }
}
