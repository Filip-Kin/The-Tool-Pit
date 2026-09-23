import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authorised } from '@/lib/internal-auth'
import { setAlbumEventMatchBody, suppressAlbumCandidateBody } from '@/lib/admin/album-decisions'
import {
  attachGrantCandidateBody,
  flagGrantCandidateBody,
  markGrantCandidateDuplicateBody,
  routeGrantCandidateToSourceBody,
  suppressGrantCandidateBody,
} from '@/lib/admin/grant-decisions'
import { formFromReviewDefaults, loadCandidate, publishCandidateFromForm } from '@/lib/admin/grant-publish'
import { reviewDefaults } from '@/lib/admin/grant-review'
import { revalidateGrantPublic } from '@/lib/admin/grants'
import { applyGrantChangeBody, dismissGrantChangeBody } from '@/lib/admin/grant-change-decisions'
import { recordDiscordDecision } from '@/lib/discord/decisions'
import {
  parseQueueRequest,
  publishFormExtras,
  type QueueDecision,
  type QueueDecisionResult,
} from '@/lib/admin/queue-decisions'

/**
 * POST /api/internal/queue-decisions
 *
 * A scripted review pass applying moderation decisions in bulk: agents that
 * have read the candidate pages decide, and this route carries the decisions
 * out. It holds the shared secret (x-internal-secret = INTERNAL_API_SECRET,
 * 404 when unset, constant-time compare), and nothing else calls it.
 *
 * NOT A SECOND PUBLISH PATH. Every decision runs the body the admin button
 * runs (lib/admin/album-decisions.ts, lib/admin/grant-decisions.ts,
 * lib/admin/grant-change-decisions.ts, publishCandidateFromForm), so the gates
 * apply unchanged: a grant publish
 * builds the same form the review deck posts, from reviewDefaults, and
 * publishBlockers / duplicateOfExisting refuse it the same way. The refusal
 * comes back verbatim in `error`. The only way past the gate is the named
 * overrideVerification field, the "publish anyway" reason an admin would type.
 *
 * A grant_change apply is the admin Apply button with the deadline tickbox
 * ticked: the caller's decision is the confirmation. The grant monitor sends
 * these as actor 'auto' for changes it proved against the funder's page
 * (apps/worker/src/grants/change-proof.ts); the proof is the worker's gate,
 * this route only carries the decision out.
 *
 * Body: { actor: { name }, decisions: QueueDecision[] } (lib/admin/queue-decisions.ts),
 * at most 200. A malformed decision fails the whole request with 400 before
 * anything runs. After that, decisions run in order and one failure never stops
 * the rest.
 *
 * Response: { results: [{ id, kind, action, ok, error?, slug?, label?, queued? }] }
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALBUM_QUEUE_PATH = '/admin/album-candidates'
const GRANT_QUEUE_PATH = '/admin/grants/candidates'
const CHANGE_QUEUE_PATH = '/admin/grants/changes'

type Outcome = Omit<QueueDecisionResult, 'id' | 'kind' | 'action' | 'ok'>

async function run(d: QueueDecision, who: string): Promise<Outcome> {
  if (d.kind === 'album') {
    if (d.action === 'approve') {
      // Setting the event on an unpublished candidate is the approval: it
      // publishes, grants ownership and emails, as the admin screen does.
      const out = await setAlbumEventMatchBody(d.id, d.eventKey)
      if (out.error) return out
      await recordDiscordDecision('album', d.id, { status: 'approved', by: who, via: 'site' })
      return {}
    }
    const out = await suppressAlbumCandidateBody(d.id, d.reason)
    if (out.error) return out
    await recordDiscordDecision('album', d.id, { status: 'rejected', by: who, via: 'site' })
    return {}
  }

  if (d.kind === 'grant_change') {
    if (d.action === 'dismiss') return dismissGrantChangeBody(d.id, who, d.note)
    const out = await applyGrantChangeBody(d.id, who, { confirmed: true })
    if (out.error || !out.grant) return { error: out.error ?? 'Change not applied.' }
    revalidatePath(`/admin/grants/${out.grant.id}`)
    revalidateGrantPublic(out.grant.slug)
    return { slug: out.grant.slug }
  }

  switch (d.action) {
    case 'suppress':
      return suppressGrantCandidateBody(d.id, d.reason, d.rejectionKind)
    case 'flag':
      return flagGrantCandidateBody(d.id, d.note)
    case 'duplicate':
      return markGrantCandidateDuplicateBody(d.id, d.grantRef ?? '')
    case 'route':
      return routeGrantCandidateToSourceBody(d.id, who)
    case 'attach':
      return attachGrantCandidateBody(d.id, d.grantRef)
    case 'publish': {
      const candidate = await loadCandidate(d.id)
      if (!candidate) return { error: 'Candidate not found.' }
      const defaults = reviewDefaults({
        url: candidate.canonicalUrl ?? candidate.sourceUrl,
        extraction: candidate.extraction,
        classification: candidate.classification,
        metadata: candidate.rawMetadata,
      })
      const { extra, programs } = publishFormExtras(d)
      const form = formFromReviewDefaults(defaults, extra)
      if (programs) {
        form.delete('programs')
        for (const p of programs) form.append('programs', p)
      }
      const out = await publishCandidateFromForm(d.id, form, who)
      if (out.error) return { error: out.error }
      // Same handling as publishGrantCandidate: a refused cycle is reported
      // with the slug of the grant that was written.
      if (out.cycleError) {
        return { error: `Grant saved, but the cycle was not: ${out.cycleError}. Add it in the editor.`, slug: out.slug }
      }
      revalidatePath('/admin/grants')
      revalidateGrantPublic(out.slug!)
      return { slug: out.slug }
    }
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }
  const parsed = parseQueueRequest(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const results: QueueDecisionResult[] = []
  let anyAlbum = false
  let anyGrant = false
  let anyChange = false
  let anyRouted = false
  for (const d of parsed.decisions) {
    if (d.kind === 'album') anyAlbum = true
    else if (d.kind === 'grant_change') anyChange = true
    else anyGrant = true
    let outcome: Outcome
    try {
      outcome = await run(d, parsed.actorName)
    } catch (err) {
      console.error(`[queue-decisions] ${d.kind} ${d.action} ${d.id} threw`, err)
      outcome = { error: err instanceof Error ? err.message : String(err) }
    }
    if (d.kind === 'grant' && d.action === 'route' && !outcome.error) anyRouted = true
    results.push({ id: d.id, kind: d.kind, action: d.action, ok: !outcome.error, ...outcome })
  }

  if (anyAlbum) revalidatePath(ALBUM_QUEUE_PATH)
  if (anyGrant) revalidatePath(GRANT_QUEUE_PATH)
  if (anyChange) revalidatePath(CHANGE_QUEUE_PATH)
  if (anyRouted) revalidatePath('/admin/grants/sources')

  return NextResponse.json({ results })
}
