import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import type { ApprovalVertical } from '@the-tool-pit/types'
import { approveCandidateBody, candidateIdForSubmission, suppressCandidateBody } from '@/lib/admin/candidate-decisions'
import { approveAlbumCandidateBody, suppressAlbumCandidateBody } from '@/lib/admin/album-decisions'
import { publishPracticeField } from '@/lib/fields/publish'
import { suppressPracticeField } from '@/lib/fields/suppress'
import { applyFieldEditProposal } from '@/lib/fields/apply-edit'
import { rejectFieldEditProposal } from '@/lib/fields/reject-edit'
import { publishEventListing } from '@/lib/events/publish'
import { suppressEventListing } from '@/lib/events/suppress'
import { applyEventEditProposal } from '@/lib/events/apply-edit'
import { rejectEventEditProposal } from '@/lib/events/reject-edit'
import { rejectSubmissionBody } from '@/lib/submissions/reject'
import { resolveClaim } from '@/lib/listings/resolve-claim'

/**
 * A decision that arrived as a reaction, dispatched to the same body the
 * admin button runs.
 *
 * ONE REASON FOR EVERY ❌. A reaction carries no text, and every reject body
 * here requires a reason because that reason is emailed to the submitter. So
 * a Discord rejection sends this one line. It is deliberately plain: it is
 * what a mentor reads in their inbox, and "rejected via Discord by Filip" is
 * not a sentence for them. A rejection that needs an explanation is done on
 * the admin page, where the reason box is.
 */
export const DISCORD_REJECT_REASON = 'Turned down after review.'

export type Decision = 'approve' | 'reject'

export interface DecisionActor {
  /** Display name, for the audit stamps that take one. */
  name: string
}

export interface DecisionResult {
  error?: string
}

/** The verticals a reaction can settle. Anything else is a post, not a decision. */
export const DECIDABLE_VERTICALS: ReadonlySet<ApprovalVertical> = new Set<ApprovalVertical>([
  'tool',
  'robot_code',
  'album',
  'field',
  'field_edit',
  'event',
  'event_edit',
  'claim',
])

/**
 * Apply `decision` to the row `entityId` names under `vertical`. Which table
 * that is follows the notice that announced it (see discord_approval_messages
 * in @the-tool-pit/db). Revalidates the same paths the admin action would.
 */
export async function decide(
  vertical: ApprovalVertical,
  entityId: string,
  decision: Decision,
  actor: DecisionActor,
): Promise<DecisionResult> {
  const approve = decision === 'approve'
  switch (vertical) {
    case 'tool':
    case 'robot_code': {
      // The post is keyed on the submission. Publishing happens on the
      // candidate the worker made of it, which may not exist yet.
      const candidateId = await candidateIdForSubmission(entityId)
      if (approve) {
        if (!candidateId) {
          const [sub] = await getDb().select({ status: submissions.status }).from(submissions).where(eq(submissions.id, entityId)).limit(1)
          if (!sub) return { error: 'Submission not found.' }
          return { error: `Not ready: the worker has not made a candidate of it yet (submission is ${sub.status}). Try again in a minute, or open the review page.` }
        }
        const out = await approveCandidateBody(candidateId)
        if (out.error) return out
        revalidatePath('/admin/candidates')
        revalidatePath(`/admin/candidates/${candidateId}`)
        revalidatePath('/admin/tools')
        revalidatePath('/admin/submissions')
        return {}
      }
      const out = candidateId
        ? await suppressCandidateBody(candidateId, DISCORD_REJECT_REASON)
        : await rejectSubmissionBody(entityId, DISCORD_REJECT_REASON)
      if (out.error) return out
      revalidatePath('/admin/candidates')
      revalidatePath('/admin/submissions')
      return {}
    }
    case 'album': {
      const out = approve ? await approveAlbumCandidateBody(entityId) : await suppressAlbumCandidateBody(entityId, DISCORD_REJECT_REASON)
      if (out.error) return out
      revalidatePath('/admin/album-candidates')
      return {}
    }
    case 'field': {
      const out = approve ? await publishPracticeField(entityId) : await suppressPracticeField(entityId, DISCORD_REJECT_REASON)
      if (out.error) return out
      revalidatePath('/admin/practice-fields')
      revalidatePath('/fields')
      return {}
    }
    case 'field_edit': {
      const out = approve ? await applyFieldEditProposal(entityId) : await rejectFieldEditProposal(entityId, DISCORD_REJECT_REASON)
      if (out.error) return out
      revalidatePath('/admin/field-edits')
      revalidatePath('/fields')
      return {}
    }
    case 'event': {
      const out = approve ? await publishEventListing(entityId) : await suppressEventListing(entityId, DISCORD_REJECT_REASON)
      if (out.error) return out
      revalidatePath('/admin/event-listings')
      revalidatePath('/events')
      return {}
    }
    case 'event_edit': {
      const out = approve ? await applyEventEditProposal(entityId) : await rejectEventEditProposal(entityId, DISCORD_REJECT_REASON)
      if (out.error) return out
      revalidatePath('/admin/event-edits')
      revalidatePath('/events')
      return {}
    }
    case 'claim': {
      // A Discord member has no users row, so the decidedBy stamp is null,
      // exactly as it is for the break-glass cookie admin. The note is what
      // the claimant is emailed on a rejection.
      const out = await resolveClaim(entityId, approve, approve ? null : DISCORD_REJECT_REASON, null)
      if (out.error) return { error: out.error }
      revalidatePath('/me/listings')
      revalidatePath('/admin/claims')
      return {}
    }
    default:
      return { error: `${vertical} posts are not decided by reaction. Open the review page.` }
  }
}
