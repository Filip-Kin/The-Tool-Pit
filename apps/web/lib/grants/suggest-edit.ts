/**
 * "Suggest an edit" on a grant, accountless, into the change queue.
 *
 * The change queue (grant_changes) is where the crawler's proposals already
 * wait for a human, with a field, an old value, a new value and the reasoning.
 * A visitor who knows the effort level or the real deadline files exactly the
 * same shape, one row per field they changed, with "Suggested by a visitor"
 * and the URL they point to as the reasoning. The admin applies or dismisses
 * it on the same screen; nothing here touches a listing.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantChanges, grantCycles, grants, GRANT_DEADLINE_TYPES, GRANT_EFFORT_LEVELS } from '@the-tool-pit/db'
import { containsHateSpeech, urlContainsHateSpeech } from '@the-tool-pit/db/hate-filter'
import { sendApprovalNotice, reviewQueueUrl, grantListingUrl } from '@the-tool-pit/types'

export interface GrantEditSuggestion {
  applicationUrl?: string
  deadlineAt?: string
  deadlineType?: string
  awardMax?: number
  effortLevel?: string
  eligibilityText?: string
  summary?: string
  note?: string
  /** Where the visitor saw it. Required: a suggestion with no source is a guess. */
  evidenceUrl: string
  email?: string
  ipHash?: string | null
  userId?: string | null
}

export interface SuggestOutcome {
  ok: boolean
  error?: string
  filed?: number
}

const URL_RE = /^https?:\/\/\S+$/i

export async function createGrantEditSuggestion(grantId: string, input: GrantEditSuggestion): Promise<SuggestOutcome> {
  const db = getDb()
  const [grant] = await db.select().from(grants).where(and(eq(grants.id, grantId), eq(grants.status, 'published'))).limit(1)
  if (!grant) return { ok: false, error: 'Grant not found.' }

  const evidenceUrl = (input.evidenceUrl ?? '').trim()
  if (!URL_RE.test(evidenceUrl)) return { ok: false, error: 'Add the link where you saw this, so a reviewer can check it.' }
  if (urlContainsHateSpeech(evidenceUrl) || containsHateSpeech(input.note, input.summary, input.eligibilityText)) {
    return { ok: false, error: 'That text cannot be submitted.' }
  }

  const who = input.userId ? `a signed-in visitor` : 'a visitor'
  const reasoning = [`Suggested by ${who} on ${new Date().toISOString().slice(0, 10)}.`, `Evidence: ${evidenceUrl}`, input.note?.trim() ? `Note: ${input.note.trim().slice(0, 600)}` : null, input.email?.trim() ? `Contact: ${input.email.trim().slice(0, 120)}` : null]
    .filter(Boolean)
    .join(' ')

  const rows: Array<{ field: string; oldValue: unknown; newValue: unknown }> = []
  const applicationUrl = input.applicationUrl?.trim()
  if (applicationUrl && URL_RE.test(applicationUrl) && applicationUrl !== grant.applicationUrl) rows.push({ field: 'applicationUrl', oldValue: grant.applicationUrl, newValue: applicationUrl })
  if (input.awardMax != null && Number.isFinite(input.awardMax) && input.awardMax > 0 && input.awardMax !== grant.awardMax) rows.push({ field: 'awardMax', oldValue: grant.awardMax, newValue: Math.round(input.awardMax) })
  const effort = input.effortLevel?.trim()
  if (effort && (GRANT_EFFORT_LEVELS as readonly string[]).includes(effort) && effort !== 'unknown' && effort !== grant.effortLevel) rows.push({ field: 'effortLevel', oldValue: grant.effortLevel, newValue: effort })
  const dtype = input.deadlineType?.trim()
  if (dtype && (GRANT_DEADLINE_TYPES as readonly string[]).includes(dtype) && dtype !== 'unknown' && dtype !== grant.deadlineType) rows.push({ field: 'deadlineType', oldValue: grant.deadlineType, newValue: dtype })
  const summary = input.summary?.trim()
  if (summary && summary.length >= 20 && summary !== grant.summary) rows.push({ field: 'summary', oldValue: grant.summary, newValue: summary.slice(0, 600) })
  const eligibility = input.eligibilityText?.trim()
  if (eligibility && eligibility.length >= 10) rows.push({ field: 'eligibilityText', oldValue: null, newValue: eligibility.slice(0, 600) })
  const deadline = input.deadlineAt?.trim()
  if (deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    const year = Number(deadline.slice(0, 4))
    const [cycle] = await db.select({ deadlineAt: grantCycles.deadlineAt }).from(grantCycles).where(and(eq(grantCycles.grantId, grant.id), eq(grantCycles.cycleYear, year))).limit(1)
    rows.push({ field: `cycle.${year}.deadlineAt`, oldValue: cycle?.deadlineAt ?? null, newValue: `${deadline}T23:59:59Z` })
  }
  if (rows.length === 0) {
    // Nothing structured changed: keep the note as an advisory row so it still reaches the reviewer.
    if (!input.note?.trim()) return { ok: false, error: 'Change something, or write what you know in the note.' }
    rows.push({ field: 'eligibilityText', oldValue: null, newValue: input.note.trim().slice(0, 600) })
  }

  await db.insert(grantChanges).values(
    rows.map((r) => ({ grantId: grant.id, field: r.field, oldValue: r.oldValue, newValue: r.newValue, reasoning, autoApplicable: false, status: 'pending' })),
  )

  sendApprovalNotice({
    vertical: 'grant',
    title: `Edit suggested: ${grant.name}`,
    reviewUrl: reviewQueueUrl('/admin/grants/changes'),
    sourceUrl: evidenceUrl,
    facts: [
      { label: 'Fields', value: rows.map((r) => r.field).join(', ') },
      { label: 'Listing', value: grantListingUrl(grant.slug) },
      ...(input.note?.trim() ? [{ label: 'Note', value: input.note.trim().slice(0, 300) }] : []),
    ],
    submitter: input.email?.trim() || null,
  })
  return { ok: true, filed: rows.length }
}
