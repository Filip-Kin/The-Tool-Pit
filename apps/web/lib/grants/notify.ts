/**
 * Discord notification for a public grant submission. Best-effort: it never
 * throws and never blocks the submission. The webhook URL is an env var
 * (GRANT_SUBMISSION_DISCORD_WEBHOOK); unset means notifications are skipped,
 * and the candidate still sits in the admin queue either way.
 *
 * Same shape as lib/fields/notify.ts, including the admin link pointing at the
 * main host: /admin is served there, not on the grants subdomain.
 */

const ADMIN_QUEUE_URL = 'https://ttp.filipkin.com/admin/grants/candidates'

interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

/** Discord rejects an empty field value, so only push the ones we have. */
function addField(fields: EmbedField[], name: string, value: string | null | undefined, inline = false): void {
  const v = value?.toString().trim()
  if (v) fields.push({ name, value: v.slice(0, 1024), inline })
}

export interface GrantSubmissionNotice {
  candidateId: string
  name: string
  funderName: string | null
  infoUrl: string
  applicationUrl: string | null
  summary: string | null
  notes: string | null
  submitterName: string | null
  submitterContact: string | null
}

export async function notifyNewGrantSubmission(s: GrantSubmissionNotice): Promise<void> {
  const webhook = process.env.GRANT_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return

  const fields: EmbedField[] = []
  addField(fields, 'Grant', s.name)
  addField(fields, 'Funder', s.funderName, true)
  addField(fields, 'Funder page', s.infoUrl)
  addField(fields, 'Application', s.applicationUrl)
  addField(fields, 'What it funds', s.summary)
  addField(fields, 'What they told us', s.notes)
  addField(fields, 'Submitter', [s.submitterName, s.submitterContact].filter(Boolean).join(' · '))

  const embed = {
    title: 'New grant submission',
    description: `Nothing is public until it is reviewed. [Open the queue](${ADMIN_QUEUE_URL}).`,
    color: 0x6366f1,
    fields,
  }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    })
  } catch {
    // Ignore. A failed notification must never affect the submission.
  }
}
