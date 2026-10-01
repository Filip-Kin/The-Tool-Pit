/**
 * Keep published practice fields current, with no work for anybody.
 *
 * WHY. A field is read once, as a candidate, and then nothing reads it again.
 * Teams change their hours, move the sign-up form, put a ceiling height on the
 * site, or stop offering the field at all, and the listing goes on saying what
 * it said in August. This job re-reads each published field's own pages once a
 * week, the same way a new candidate is read (read-field.ts), and writes back
 * what changed.
 *
 * THE RULES, in the order they are applied:
 *
 *  1. A CLAIMED field is never touched. A row in listing_owners means somebody
 *     maintains it, and a reading of their own website is not a reason to
 *     overwrite what they typed. Only status 'published' is read.
 *  2. Unchanged pages cost nothing. The fetched text is hashed per field in
 *     Redis; the same hash as last week skips the model call.
 *  3. A change is applied ONLY when its quote is literally in the fetched text.
 *     read-field.ts already checks that, and this module checks it again
 *     against the same texts, because here the write lands on a public listing
 *     and not on a candidate a moderator reviews.
 *  4. Nothing is cleared. A reading that no longer mentions the hours is a page
 *     that moved them, not a field that stopped having hours. 'unknown'
 *     availability counts as empty for the same reason.
 *  5. A value a person set is not overwritten. practice_fields has no
 *     human_edited_fields column (tools and events do; see
 *     @the-tool-pit/db/human-edited), so the only per-value record of a person
 *     is an APPLIED community edit (field_edit_proposals). A column whose
 *     stored value is what an applied edit set is left alone.
 *  6. "The field is closed", quoted, unpublishes it (status 'suppressed').
 *
 * NO QUEUE FOR HUMANS. A change that fails a rule is logged and dropped. Next
 * week's read tries again, and a page that really changed will say so again.
 *
 * One Discord alert per field that changed, one fact per column.
 */
import { createHash } from 'node:crypto'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import {
  getDb,
  practiceFields,
  practiceFieldCandidates,
  listingOwners,
  fieldEditProposals,
  type PracticeField,
} from '@the-tool-pit/db'
import { sendApprovalNotice, siteUrl, type ApprovalFact } from '@the-tool-pit/types'
import { readFieldCandidate } from './read-field.js'
import { fetchChiefDelphiTopic, parseChiefDelphiTopicId } from '../connectors/discourse.js'
import { renderPage, htmlToText } from '../connectors/playwright-render.js'
import { politeFetch } from '../connectors/base.js'
import { fetchWithRelayFallback } from '../grants/relay-fetch.js'
import { normaliseForQuoteMatch, quoteSource, urlSource, type NamedText } from '../model/evidence.js'
import { getRedis } from '../redis.js'

// #region vocabulary

/**
 * The columns a refresh may write: the columns the reader reads, less two.
 *
 * NOT `name`: it is the listing's identity, and a reader naming the place from
 * a team's homepage ("FRC Team 195 CyberKnights") would rename a curated
 * "Team 195 Practice Field" for no reason a visitor cares about.
 * NOT `notes`: the reader picks one sentence it thinks a visitor would want,
 * and a different pick next week is not the field changing.
 */
export const REFRESH_KEYS = [
  'teamNumber', 'teamName', 'program', 'address', 'city', 'region', 'country',
  'hours', 'availability', 'coverage', 'perimeter', 'elements', 'hasFms', 'ceilingHeightFt',
  'contactInfo', 'contactUrl', 'website',
] as const
export type RefreshKey = (typeof REFRESH_KEYS)[number]

/** Discord fact labels. One to three words each (discord-copy-is-labels.test.ts). */
export const REFRESH_LABELS: Record<RefreshKey | 'status', string> = {
  teamNumber: 'Team',
  teamName: 'Team name',
  program: 'Program',
  address: 'Address',
  city: 'City',
  region: 'Region',
  country: 'Country',
  hours: 'Hours',
  availability: 'Availability',
  coverage: 'Coverage',
  perimeter: 'Perimeter',
  elements: 'Elements',
  hasFms: 'FMS',
  ceilingHeightFt: 'Ceiling',
  contactInfo: 'Contact',
  contactUrl: 'Sign-up link',
  website: 'Website',
  status: 'Status',
}

const URL_KEYS = new Set<string>(['contactUrl', 'website'])
/** Shorter than this is a match by accident, the same floor read-field.ts uses. */
const MIN_QUOTE = 10

// #endregion

// #region pure diff

export interface RefreshChange {
  key: RefreshKey | 'status'
  from: unknown
  to: unknown
  quote: string
  source: string
}

export interface RefreshPlan {
  /** Set when the field is not refreshed at all. */
  skipped: 'claimed' | 'not-published' | null
  changes: RefreshChange[]
  /** Proposed changes that failed a rule, as "key: reason". Logged, never applied. */
  refused: string[]
}

/** Empty for this purpose: nothing, blank text, or an availability nobody stated. */
export function isEmptyValue(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (key === 'availability' && value === 'unknown') return true
  return false
}

const bareUrl = (u: string) =>
  u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')

/**
 * Same value, loosely. Case, spacing and typographic quotes are not a change,
 * nor is a URL that differs only by scheme, www or a trailing slash, nor 12
 * against 12.0. A change of that size would be an alert about nothing.
 */
export function sameFieldValue(key: string, a: unknown, b: unknown): boolean {
  if (isEmptyValue(key, a) && isEmptyValue(key, b)) return true
  if (isEmptyValue(key, a) !== isEmptyValue(key, b)) return false
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b
  if (URL_KEYS.has(key)) return bareUrl(String(a)) === bareUrl(String(b))
  return normaliseForQuoteMatch(String(a)) === normaliseForQuoteMatch(String(b))
}

/**
 * Where the evidence for a value is, in the texts actually fetched. A URL is
 * proven by presence (the page links it); anything else by its quote.
 */
function proofSource(
  key: string,
  value: unknown,
  quote: string,
  sources: ReadonlyArray<NamedText<string>>,
): string | null {
  if (URL_KEYS.has(key) && typeof value === 'string') return urlSource(value, sources)
  return quoteSource(quote, sources, MIN_QUOTE)
}

/**
 * Columns whose stored value a person set through an applied community edit.
 *
 * Each proposal is a full snapshot of the form, so "the stored value equals
 * what an applied edit set" is the test: a person either typed that value or
 * read it and kept it, and either way it is theirs.
 */
export function personSetKeys(
  current: Record<string, unknown>,
  appliedEdits: ReadonlyArray<Record<string, unknown>>,
): Set<string> {
  const out = new Set<string>()
  for (const edit of appliedEdits) {
    for (const key of REFRESH_KEYS) {
      if (!(key in edit) || isEmptyValue(key, edit[key])) continue
      if (sameFieldValue(key, edit[key], current[key])) out.add(key)
    }
  }
  return out
}

/**
 * What a refresh would write to one field, and why everything else was not.
 * Pure: the job reads the inputs, this decides, the job writes.
 */
export function planFieldRefresh(input: {
  current: Record<string, unknown> & { status: string }
  claimed: boolean
  /** The reader's checked values (FieldRead.fields), `closed` included. */
  read: Record<string, unknown>
  evidence: Record<string, { quote: string; source: string }>
  /** Every text that was fetched for this read. */
  sources: ReadonlyArray<NamedText<string>>
  /** See personSetKeys. */
  personSet?: ReadonlySet<string>
}): RefreshPlan {
  if (input.claimed) return { skipped: 'claimed', changes: [], refused: [] }
  if (input.current.status !== 'published') return { skipped: 'not-published', changes: [], refused: [] }

  const changes: RefreshChange[] = []
  const refused: string[] = []

  for (const key of REFRESH_KEYS) {
    if (!(key in input.read)) continue
    const next = input.read[key]
    const prev = input.current[key]
    if (sameFieldValue(key, prev, next)) continue

    if (isEmptyValue(key, next)) {
      refused.push(`${key}: would clear the stored value`)
      continue
    }
    if (input.personSet?.has(key)) {
      refused.push(`${key}: set by a person`)
      continue
    }
    const quote = input.evidence[key]?.quote ?? ''
    const source = proofSource(key, next, quote, input.sources)
    if (!source) {
      refused.push(`${key}: quote not in the fetched text`)
      continue
    }
    changes.push({ key, from: prev ?? null, to: next, quote, source })
  }

  if (input.read.closed === true) {
    const quote = input.evidence.closed?.quote ?? ''
    const source = quoteSource(quote, input.sources, MIN_QUOTE)
    if (source) changes.push({ key: 'status', from: input.current.status, to: 'suppressed', quote, source })
    else refused.push('closed: quote not in the fetched text')
  }

  return { skipped: null, changes, refused }
}

/** A value as it reads in the alert: short, and "none" for nothing. */
export function showValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

/** One fact per changed column, "old → new". */
export function changeFacts(changes: readonly RefreshChange[]): ApprovalFact[] {
  return changes.map((c) => ({
    label: REFRESH_LABELS[c.key],
    value: `${showValue(c.from)} → ${showValue(c.to)}`,
  }))
}

/** The hash a week's fetch is compared on. Order-independent across sources. */
export function sourcesHash(sources: ReadonlyArray<NamedText<string>>): string {
  const body = [...sources]
    .sort((a, b) => a.source.localeCompare(b.source))
    .map((s) => `${s.source}\n${normaliseForQuoteMatch(s.text)}`)
    .join('\n\n')
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

// #endregion

// #region fetching

/**
 * A page's visible text: the browser first (it falls back to a plain fetch on
 * its own), then the NAS relay when the worker's IP was refused.
 */
async function readPageText(url: string): Promise<string | null> {
  const rendered = await renderPage(url)
  if (rendered && rendered.text.length >= 200) return rendered.text
  try {
    const out = await fetchWithRelayFallback(url, () => politeFetch(url))
    if (out.via !== 'direct' && out.res.ok) {
      const text = htmlToText(await out.res.text())
      if (text.length > (rendered?.text.length ?? 0)) return text
    }
  } catch {
    // Neither path read it; the browser's short text, if any, is all there is.
  }
  return rendered?.text ?? null
}

/** The Chief Delphi thread a field was accepted from, when it came from one. */
async function threadSource(url: string): Promise<string | null> {
  const topicId = parseChiefDelphiTopicId(url)
  if (topicId === null) return null
  const detail = await fetchChiefDelphiTopic(topicId)
  if (!detail) return null
  return detail.raw || htmlToText(detail.html)
}

/**
 * Every page a field can be read from: the thread it was found in, its own
 * website, and its sign-up link. Pages that would not load are left out.
 */
async function fetchFieldSources(urls: readonly string[]): Promise<NamedText<string>[]> {
  const out: NamedText<string>[] = []
  for (const url of urls) {
    const text = parseChiefDelphiTopicId(url) !== null ? await threadSource(url) : await readPageText(url)
    if (text && text.trim()) out.push({ source: url, text })
  }
  return out
}

// #endregion

// #region job

export interface FieldRefreshPayload {
  /** Refresh one field, ignoring the unchanged-page hash. */
  fieldId?: string
}

export interface FieldRefreshStats {
  considered: number
  claimed: number
  noSource: number
  unchanged: number
  read: number
  updated: number
  closed: number
  refused: number
  failed: number
}

const HASH_KEY = (id: string) => `field-refresh:hash:${id}`
/** Long enough to outlive a missed week or two. */
const HASH_TTL_SECONDS = 60 * 24 * 60 * 60

export async function processFieldRefreshJob(payload: FieldRefreshPayload = {}): Promise<FieldRefreshStats> {
  const db = getDb()
  const redis = getRedis()
  const stats: FieldRefreshStats = {
    considered: 0, claimed: 0, noSource: 0, unchanged: 0, read: 0, updated: 0, closed: 0, refused: 0, failed: 0,
  }

  const rows = await db
    .select()
    .from(practiceFields)
    .where(payload.fieldId ? eq(practiceFields.id, payload.fieldId) : eq(practiceFields.status, 'published'))
  stats.considered = rows.length
  if (rows.length === 0) return stats

  const ids = rows.map((r) => r.id)
  const owned = new Set(
    (
      await db
        .select({ id: listingOwners.entityId })
        .from(listingOwners)
        .where(and(eq(listingOwners.entityType, 'field'), inArray(listingOwners.entityId, ids)))
    ).map((r) => r.id),
  )
  const threads = await db
    .select({ fieldId: practiceFieldCandidates.matchedFieldId, url: practiceFieldCandidates.sourceUrl })
    .from(practiceFieldCandidates)
    .where(and(isNotNull(practiceFieldCandidates.matchedFieldId), inArray(practiceFieldCandidates.matchedFieldId, ids)))
  const edits = await db
    .select({ fieldId: fieldEditProposals.fieldId, proposed: fieldEditProposals.proposed })
    .from(fieldEditProposals)
    .where(and(eq(fieldEditProposals.status, 'applied'), inArray(fieldEditProposals.fieldId, ids)))

  for (const field of rows) {
    // Claimed and unpublished fields stop here, before any network.
    const gate = planFieldRefresh({
      current: field as unknown as Record<string, unknown> & { status: string },
      claimed: owned.has(field.id),
      read: {},
      evidence: {},
      sources: [],
    })
    if (gate.skipped) {
      if (gate.skipped === 'claimed') stats.claimed++
      continue
    }

    const urls = [
      ...threads.filter((t) => t.fieldId === field.id).map((t) => t.url),
      field.website,
      field.contactUrl,
    ].filter((u, i, all): u is string => typeof u === 'string' && /^https?:\/\//i.test(u) && all.indexOf(u) === i)
    if (urls.length === 0) {
      stats.noSource++
      continue
    }

    try {
      const sources = await fetchFieldSources(urls)
      if (sources.length === 0) {
        stats.failed++
        console.warn(`[field-refresh] ${field.name}: no page loaded (${urls.join(', ')})`)
        continue
      }

      const hash = sourcesHash(sources)
      if (!payload.fieldId && (await redis.get(HASH_KEY(field.id))) === hash) {
        stats.unchanged++
        continue
      }

      const read = await readFieldCandidate({
        threadUrl: urls[0],
        title: field.name,
        threadText: sources.map((s) => `Page: ${s.source}\n${s.text}`).join('\n\n'),
        links: urls,
        refresh: true,
      })
      // No hash stored on a failed read, so next week reads it again.
      if (!read) {
        stats.failed++
        continue
      }
      stats.read++

      const personSet = personSetKeys(
        field as unknown as Record<string, unknown>,
        edits.filter((e) => e.fieldId === field.id).map((e) => e.proposed as Record<string, unknown>),
      )
      const plan = planFieldRefresh({
        current: field as unknown as Record<string, unknown> & { status: string },
        claimed: false,
        read: read.fields as Record<string, unknown>,
        evidence: read.evidence,
        // The fetched pages, plus any page the reader opened on its own.
        sources: [...sources, ...read.sources],
        personSet,
      })

      for (const why of plan.refused) console.log(`[field-refresh] ${field.name}: not applied, ${why}`)
      stats.refused += plan.refused.length

      if (plan.changes.length > 0) {
        await applyChanges(field, plan.changes)
        stats.updated++
        if (plan.changes.some((c) => c.key === 'status')) stats.closed++
        notifyFieldUpdated(field, plan.changes)
      }

      await redis.set(HASH_KEY(field.id), hash, 'EX', HASH_TTL_SECONDS)
    } catch (err) {
      stats.failed++
      console.error(`[field-refresh] ${field.name} failed:`, err)
    }
  }

  console.log(
    `[field-refresh] ${stats.considered} fields: ${stats.updated} updated (${stats.closed} closed), ` +
      `${stats.unchanged} unchanged, ${stats.claimed} claimed, ${stats.noSource} no source, ` +
      `${stats.refused} changes refused, ${stats.failed} failed`,
  )
  return stats
}

async function applyChanges(field: PracticeField, changes: readonly RefreshChange[]): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const c of changes) patch[c.key] = c.to
  await getDb()
    .update(practiceFields)
    .set(patch as Partial<PracticeField>)
    .where(eq(practiceFields.id, field.id))
  for (const c of changes) {
    console.log(
      `[field-refresh] ${field.name}: ${c.key} ${showValue(c.from)} -> ${showValue(c.to)} ("${c.quote.slice(0, 120)}", ${c.source})`,
    )
  }
}

function notifyFieldUpdated(field: PracticeField, changes: readonly RefreshChange[]): void {
  const facts = changeFacts(changes)
  sendApprovalNotice({
    vertical: 'field',
    alert: true,
    title: `Field updated: ${field.name}`,
    reviewUrl: `${siteUrl().replace(/\/+$/, '')}/fields/${field.slug}`,
    sourceUrl: changes[0]?.source.startsWith('http') ? changes[0].source : null,
    facts,
  })
}

// #endregion
