import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import { ARTIFACT_KINDS, MIN_SEASON_YEAR, maxSeasonYear, type ArtifactKind } from '@the-tool-pit/db/robot-code-enums'
import { FIELD_PROGRAMS, type FieldProgram } from '@the-tool-pit/db/field-enums'
import { getSubmissionQueue } from '@/lib/submissions/queue'
import { sendApprovalNotice, reviewSubmissionUrl } from '@the-tool-pit/types'

/**
 * Public robot code / CAD submissions.
 *
 * These land in `submissions` exactly like a tool submitted through the generic
 * form, so there is one moderation queue rather than a second table nobody
 * remembers to check. What is different is the four columns the submitter fills
 * in: program, team number, season and code-vs-CAD.
 *
 * Those four are the axes the archive is indexed on, and they are the ones a
 * classifier gets wrong. It reads 971 out of a repo called "frc-971-2024" and
 * it is right, then it reads 2024 out of "team1234-2024-offseason-fork-of-254"
 * and files someone else's robot under the wrong team. Attributing a team's
 * work to the wrong team is worse than not listing it, so we take them from the
 * person who knows, carry them through the pipeline untouched, and hand them to
 * the reviewer already filled in.
 *
 * Nothing here publishes. The worker turns the submission into a pending
 * candidate with the submitter's facts already written into its classification
 * and stops there, and a human approves it from the admin queue.
 */

export interface CreateRobotCodeSubmissionInput {
  /** Repo or model link. GitHub, Onshape, GrabCAD and Fusion/A360 are the realistic hosts. */
  url: string
  program: string
  teamNumber: number
  seasonYear: number
  artifactKind: string
  note?: string
  submitterIpHash: string
  /**
   * The signed-in user, when there was one. Optional on purpose: sign-in is
   * never a wall in front of a submission. It only buys attribution and an
   * email when a moderator gets to it.
   */
  submittedByUserId?: string
  /**
   * What the "just passing it along" box said, resolved by the route with
   * lib/listings/passing-along.ts. NULL for a signed-out submitter, TRUE means
   * the listing is theirs when a moderator approves it.
   */
  submitterOwns?: boolean | null
}

export type CreateRobotCodeSubmissionResult =
  | { status: 'pending'; submissionId: string; message: string }
  | { status: 'duplicate'; message: string; slug?: string }
  | { status: 'error'; message: string }

/** Accept only what a browser can actually open, and reject a bare word typed into a URL box. */
function validUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname.includes('.')) return null
  return u.toString()
}

export async function createRobotCodeSubmission(
  input: CreateRobotCodeSubmissionInput,
): Promise<CreateRobotCodeSubmissionResult> {
  const url = validUrl(input.url ?? '')
  if (!url) {
    return { status: 'error', message: 'Please give a full link, starting with https://' }
  }

  if (!FIELD_PROGRAMS.includes(input.program as FieldProgram)) {
    return { status: 'error', message: 'Please pick FRC, FTC or FLL.' }
  }
  const program = input.program as FieldProgram

  if (!ARTIFACT_KINDS.includes(input.artifactKind as ArtifactKind)) {
    return { status: 'error', message: 'Please say whether this is robot code or CAD.' }
  }
  const artifactKind = input.artifactKind as ArtifactKind

  if (!Number.isInteger(input.teamNumber) || input.teamNumber < 1 || input.teamNumber > 99999) {
    return { status: 'error', message: 'Please give a team number between 1 and 99999.' }
  }

  const maxYear = maxSeasonYear()
  if (!Number.isInteger(input.seasonYear) || input.seasonYear < MIN_SEASON_YEAR || input.seasonYear > maxYear) {
    return { status: 'error', message: `Please give a season between ${MIN_SEASON_YEAR} and ${maxYear}.` }
  }

  const db = getDb()

  // Courtesy check only, on the URL as typed. The real dedup runs in the worker
  // against the canonicalised URL and covers crawled tools too, so a near-miss
  // here costs a reviewer one click, not a duplicate listing.
  const [existing] = await db
    .select({ id: submissions.id, status: submissions.status, resolvedToolId: submissions.resolvedToolId })
    .from(submissions)
    .where(eq(submissions.url, url))
    .limit(1)

  if (existing) {
    if (existing.status === 'published' && existing.resolvedToolId) {
      return { status: 'duplicate', message: 'We already list this one.' }
    }
    if (existing.status !== 'rejected') {
      return {
        status: 'duplicate',
        message: 'This one is already waiting to be reviewed. Nothing more needed from you.',
      }
    }
  }

  const [created] = await db
    .insert(submissions)
    .values({
      url,
      submitterNote: input.note?.trim() || null,
      submitterIpHash: input.submitterIpHash || null,
      submittedByUserId: input.submittedByUserId ?? null,
      submitterOwns: input.submitterOwns ?? null,
      program,
      teamNumber: input.teamNumber,
      seasonYear: input.seasonYear,
      artifactKind,
      status: 'pending',
      pipelineLog: [
        {
          stage: 'received',
          status: 'ok',
          message: `Team ${input.teamNumber} ${program.toUpperCase()} ${input.seasonYear} ${artifactKind}, stated by the submitter`,
          timestamp: new Date().toISOString(),
        },
      ],
    })
    .returning({ id: submissions.id })

  // Same queue as the generic form. The worker reads artifactKind, skips
  // classification because there is nothing left to decide, and leaves a
  // pending candidate for a human.
  await getSubmissionQueue().add('process-submission', { submissionId: created.id })

  // Team, season and kind lead, because they are the three the reviewer checks
  // against the repo rather than reads off the page.
  sendApprovalNotice({
    vertical: 'robot_code',
    title: `${program.toUpperCase()} ${input.teamNumber}, ${input.seasonYear}`,
    reviewUrl: reviewSubmissionUrl(created.id),
    sourceUrl: url,
    facts: [
      { label: 'Team', value: `${program.toUpperCase()} ${input.teamNumber}`, inline: true },
      { label: 'Season', value: String(input.seasonYear), inline: true },
      { label: 'Kind', value: artifactKind === 'cad' ? 'CAD' : 'Robot code', inline: true },
      { label: 'Note', value: input.note?.trim() || null },
    ],
  })

  return {
    status: 'pending',
    submissionId: created.id,
    message: `Thanks. Team ${input.teamNumber}'s ${input.seasonYear} ${artifactKind === 'cad' ? 'CAD' : 'code'} is queued for review, so it will not appear straight away.`,
  }
}
