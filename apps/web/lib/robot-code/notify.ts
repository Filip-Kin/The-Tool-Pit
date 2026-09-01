/**
 * Discord notification for a public robot code / CAD submission. Best-effort:
 * it never throws and never blocks the submission. The webhook URL is an env
 * var (ROBOT_CODE_SUBMISSION_DISCORD_WEBHOOK); unset means notifications are
 * skipped, and the submission still sits in the admin queue either way.
 *
 * Same shape as lib/grants/notify.ts, including the admin link pointing at the
 * main host: /admin is served there, not on the robot-code subdomain.
 */

const ADMIN_QUEUE_URL = 'https://frc.tools/admin/submissions'

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

export interface RobotCodeSubmissionNotice {
  submissionId: string
  url: string
  program: string
  teamNumber: number
  seasonYear: number
  artifactKind: 'code' | 'cad'
  note: string | null
}

export async function notifyNewRobotCodeSubmission(s: RobotCodeSubmissionNotice): Promise<void> {
  const webhook = process.env.ROBOT_CODE_SUBMISSION_DISCORD_WEBHOOK
  if (!webhook) return

  const fields: EmbedField[] = []
  // Team, season and kind lead, because they are the three the reviewer is
  // checking against the repo rather than reading off the page.
  addField(fields, 'Team', `${s.program.toUpperCase()} ${s.teamNumber}`, true)
  addField(fields, 'Season', String(s.seasonYear), true)
  addField(fields, 'Kind', s.artifactKind === 'cad' ? 'CAD' : 'Robot code', true)
  addField(fields, 'Link', s.url)
  addField(fields, 'Note', s.note)

  const embed = {
    title: 'New robot code / CAD submission',
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
