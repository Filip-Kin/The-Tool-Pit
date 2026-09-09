/**
 * "Suggest an edit" on a grant, accountless, into the change queue.
 *
 * The change queue (grant_changes) is where the crawler's proposals already
 * wait for a human, with a field, an old value, a new value and the reasoning.
 * A visitor who knows better files exactly the same shape, one row per field
 * they changed, with "Suggested by a visitor" and the URL they point to as
 * the reasoning. Every fact on the public page can be corrected here: the
 * admin applies or dismisses it on the same screen; nothing here touches a
 * listing.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantChanges, grantCycles, grants } from '@the-tool-pit/db'
import { GRANT_APPLY_METHODS, GRANT_DEADLINE_TYPES, GRANT_EFFORT_LEVELS, GRANT_GEO_SCOPES, GRANT_PROGRAMS } from '@the-tool-pit/db/grant-enums'
import { containsHateSpeech, urlContainsHateSpeech } from '@the-tool-pit/db/hate-filter'
import { sendApprovalNotice, reviewQueueUrl, grantListingUrl } from '@the-tool-pit/types'
import { adminSubmitter } from '@/lib/admin/auto-approve'
import { adminName } from '@/lib/admin/auth'
import { applyGrantChangeRow } from '@/lib/admin/grant-changes'
import { revalidateGrantPublic } from '@/lib/admin/grants'

export interface GrantEditSuggestion {
  /** Raw form values, by the same names the page shows them under. */
  fields: Record<string, string | undefined>
  /** Where the visitor saw it. Required: a suggestion with no source is a guess. */
  evidenceUrl: string
  ipHash?: string | null
  userId?: string | null
}

export interface SuggestOutcome {
  ok: boolean
  error?: string
  filed?: number
  /** Rows written to the listing on the spot, which only happens for an admin. */
  applied?: number
}

const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Row = { field: string; oldValue: unknown; newValue: unknown }

export async function createGrantEditSuggestion(grantId: string, input: GrantEditSuggestion): Promise<SuggestOutcome> {
  const db = getDb()
  const [grant] = await db.select().from(grants).where(and(eq(grants.id, grantId), eq(grants.status, 'published'))).limit(1)
  if (!grant) return { ok: false, error: 'Grant not found.' }

  const evidenceUrl = (input.evidenceUrl ?? '').trim()
  if (!URL_RE.test(evidenceUrl)) return { ok: false, error: 'Add the link where you saw this, so a reviewer can check it.' }
  const text = (k: string) => (typeof input.fields[k] === 'string' ? input.fields[k]!.trim() : '')
  if (urlContainsHateSpeech(evidenceUrl) || containsHateSpeech(text('note'), text('summary'), text('description'), text('eligibilityText'), text('name'), text('awardNotes'), text('localityNote'))) {
    return { ok: false, error: 'That text cannot be submitted.' }
  }

  const admin = await adminSubmitter(input.userId)
  const who = admin ? `an admin (${adminName(admin)})` : input.userId ? 'a signed-in visitor' : 'a visitor'
  const note = text('note')
  const email = text('email')
  const reasoning = [`Suggested by ${who} on ${new Date().toISOString().slice(0, 10)}.`, `Evidence: ${evidenceUrl}`, note ? `Note: ${note.slice(0, 600)}` : null, email ? `Contact: ${email.slice(0, 120)}` : null]
    .filter(Boolean)
    .join(' ')

  const rows: Row[] = []
  const push = (field: string, oldValue: unknown, newValue: unknown) => {
    if (JSON.stringify(oldValue ?? null) !== JSON.stringify(newValue ?? null)) rows.push({ field, oldValue: oldValue ?? null, newValue })
  }
  // Text fields: a changed value is a change; blank means "no opinion".
  const textFields: Array<[string, string | null, number, number]> = [
    ['name', grant.name, 3, 200],
    ['summary', grant.summary, 20, 600],
    ['description', grant.description, 20, 4000],
    ['awardNotes', grant.awardNotes, 3, 500],
    ['localityNote', grant.localityNote, 3, 300],
    ['mailingAddress', grant.mailingAddress, 8, 400],
  ]
  for (const [field, oldValue, min, max] of textFields) {
    const v = text(field)
    if (v && v.length >= min) push(field, oldValue, v.slice(0, max))
  }
  for (const [field, oldValue] of [['infoUrl', grant.infoUrl], ['applicationUrl', grant.applicationUrl]] as const) {
    const v = text(field)
    if (v && URL_RE.test(v)) push(field, oldValue, v)
  }
  const contact = text('contactEmail')
  if (contact && EMAIL_RE.test(contact)) push('contactEmail', grant.contactEmail, contact)
  // Enums: "unknown"/"not sure" is no opinion.
  const enums: Array<[string, readonly string[], string | null]> = [
    ['applyMethod', GRANT_APPLY_METHODS, grant.applyMethod],
    ['effortLevel', GRANT_EFFORT_LEVELS, grant.effortLevel],
    ['deadlineType', GRANT_DEADLINE_TYPES, grant.deadlineType],
    ['geoScope', GRANT_GEO_SCOPES, grant.geoScope],
  ]
  for (const [field, allowed, oldValue] of enums) {
    const v = text(field)
    if (v && allowed.includes(v) && v !== 'unknown') push(field, oldValue, v)
  }
  const renewable = text('renewable')
  if (renewable === 'yes' || renewable === 'no') push('renewable', grant.renewable, renewable === 'yes')
  // Numbers.
  for (const [field, oldValue] of [['awardMin', grant.awardMin], ['awardMax', grant.awardMax]] as const) {
    const raw = text(field).replace(/[^0-9.]/g, '')
    if (!raw) continue
    const n = Math.round(Number(raw))
    if (Number.isFinite(n) && n > 0) push(field, oldValue, n)
  }
  const currency = text('awardCurrency').toUpperCase()
  if (/^[A-Z]{3}$/.test(currency)) push('awardCurrency', grant.awardCurrency, currency)
  // Lists: comma-separated codes, upper-cased, deduped; programs are the enum.
  const list = (k: string) => text(k).split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i)
  const countries = list('countries').filter((c) => /^[A-Z]{2}$/.test(c))
  if (text('countries')) push('countries', grant.countries, countries)
  const regions = list('regions').filter((r) => /^[A-Z]{2,3}$/.test(r))
  if (text('regions')) push('regions', grant.regions, regions)
  const programs = text('programs').split(/[,\s]+/).map((p) => p.trim().toLowerCase()).filter((p) => (GRANT_PROGRAMS as readonly string[]).includes(p)).filter((x, i, a) => a.indexOf(x) === i)
  if (programs.length) push('programs', grant.programs, programs)
  // Eligibility has no column; it is a note for the reviewer to turn into requirement rows.
  const eligibility = text('eligibilityText')
  if (eligibility && eligibility.length >= 10) rows.push({ field: 'eligibilityText', oldValue: null, newValue: eligibility.slice(0, 600) })
  // The round: deadline, opens, decisions, all on that year's cycle.
  const deadline = text('deadlineAt')
  const opens = text('opensAt')
  const decision = text('decisionAt')
  const year = /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? Number(deadline.slice(0, 4)) : /^\d{4}-\d{2}-\d{2}$/.test(opens) ? Number(opens.slice(0, 4)) + (opens.slice(5, 7) >= '07' ? 1 : 0) : null
  if (year) {
    const [cycle] = await db.select().from(grantCycles).where(and(eq(grantCycles.grantId, grant.id), eq(grantCycles.cycleYear, year))).limit(1)
    if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) push(`cycle.${year}.deadlineAt`, cycle?.deadlineAt?.toISOString() ?? null, `${deadline}T23:59:59Z`)
    if (/^\d{4}-\d{2}-\d{2}$/.test(opens)) push(`cycle.${year}.opensAt`, cycle?.opensAt ?? null, opens)
    if (/^\d{4}-\d{2}-\d{2}$/.test(decision)) push(`cycle.${year}.decisionAt`, cycle?.decisionAt ?? null, decision)
    const dnote = text('deadlineNote')
    if (dnote) push(`cycle.${year}.deadlineNote`, cycle?.deadlineNote ?? null, dnote.slice(0, 300))
  }
  if (rows.length === 0) {
    // Nothing structured changed: keep the note as an advisory row so it still reaches the reviewer.
    if (!note) return { ok: false, error: 'Change something, or write what you know in the note.' }
    rows.push({ field: 'eligibilityText', oldValue: null, newValue: note.slice(0, 600) })
  }

  const filed = await db
    .insert(grantChanges)
    .values(
      rows.map((r) => ({ grantId: grant.id, field: r.field, oldValue: r.oldValue, newValue: r.newValue, reasoning, autoApplicable: false, status: 'pending' })),
    )
    .returning({ id: grantChanges.id })

  // An admin's own suggestion is applied now, with the same code the Apply
  // button runs, and stamped with their name. Advisory rows (eligibilityText,
  // a bare note) have no column and stay pending for the admin to act on. No
  // Discord notice.
  if (admin) {
    let applied = 0
    for (const row of filed) {
      const out = await applyGrantChangeRow(row.id, adminName(admin), { confirmed: true })
      if (!out.error) applied++
    }
    if (applied > 0) revalidateGrantPublic(grant.slug)
    return { ok: true, filed: rows.length, applied }
  }

  sendApprovalNotice({
    vertical: 'grant',
    title: `Edit suggested: ${grant.name}`,
    reviewUrl: reviewQueueUrl('/admin/grants/changes'),
    sourceUrl: evidenceUrl,
    facts: [
      { label: 'Fields', value: rows.map((r) => r.field).join(', ') },
      { label: 'Listing', value: grantListingUrl(grant.slug) },
      ...(note ? [{ label: 'Note', value: note.slice(0, 300) }] : []),
    ],
    submitter: email || null,
  })
  return { ok: true, filed: rows.length }
}
