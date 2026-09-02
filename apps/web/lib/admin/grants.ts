/**
 * Shared server helpers for the grants admin. The whole grants design rests on
 * a human gate: a crawl may only ever write `lastCheckedAt` and `contentHash`,
 * and every fact that reaches a published listing passes through a person on
 * one of these screens. These helpers are the bits that more than one of those
 * screens needs, so the rules live in one place rather than being re-typed per
 * route.
 */
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { slugify } from '@/lib/utils/slugify'
import { grantFunders, grants, grantSources } from '@the-tool-pit/db'
import type { NewGrant } from '@the-tool-pit/db'
import {
  FUNDER_TYPES,
  GRANT_CYCLE_STATUSES,
  GRANT_DEADLINE_TYPES,
  GRANT_EFFORT_LEVELS,
  GRANT_FIELD_FILL_KINDS,
  GRANT_APPLY_METHODS,
  GRANT_GEO_SCOPES,
  GRANT_PROGRAMS,
  GRANT_REQUIREMENT_KINDS,
  GRANT_REQUIREMENT_OPERATORS,
  GRANT_STATUSES,
} from '@the-tool-pit/db'

// #region identity

/**
 * Who is doing the moderating, for the `verifiedBy` / `reviewedBy` stamps.
 *
 * Authelia's forward-auth sets Remote-User on /admin and Traefik overwrites any
 * client-supplied copy, so the header is trustworthy here for the same reason
 * lib/admin/auth.ts trusts Remote-Groups. The break-glass ADMIN_SECRET cookie
 * carries no identity, so it stamps 'admin' rather than pretending to know.
 */
export async function adminIdentity(): Promise<string> {
  const h = await headers()
  const user = h.get('remote-user')?.trim()
  if (user) return user
  const email = h.get('remote-email')?.trim()
  if (email) return email
  return 'admin'
}

// #endregion

// #region cache

/**
 * Bust the public grant pages. Called after anything that can change what a
 * team sees, including a verify stamp, because "verified on <date>" is rendered
 * on the listing.
 */
export function revalidateGrantPublic(slug?: string | null) {
  revalidatePath('/grants')
  if (slug) revalidatePath(`/grants/${slug}`)
}

// #endregion

// #region slugs and funders

/** A slug nobody else is using. `ignoreGrantId` lets a rename keep its own slug. */
export async function uniqueGrantSlug(base: string, ignoreGrantId?: string): Promise<string> {
  const db = getDb()
  const root = (slugify(base) || 'grant').slice(0, 80)
  let slug = root
  for (let attempt = 1; ; attempt++) {
    const [clash] = await db
      .select({ id: grants.id })
      .from(grants)
      .where(ignoreGrantId ? and(eq(grants.slug, slug), ne(grants.id, ignoreGrantId)) : eq(grants.slug, slug))
      .limit(1)
    if (!clash) return slug
    slug = `${root}-${attempt}`
  }
}

/**
 * Find a funder by name, or create a bare one. Deliberately matched on the
 * slug rather than the display name: "Gene Haas Foundation" and "Gene Haas
 * foundation" are the same cheque, and a duplicate funder row splits the
 * sponsor-mention count that discovery relies on.
 */
export async function resolveFunderByName(
  name: string,
  opts: { type?: string; website?: string | null } = {},
): Promise<string | null> {
  const clean = name.trim()
  if (!clean) return null
  const db = getDb()
  const slug = slugify(clean).slice(0, 80) || 'funder'

  const [existing] = await db.select({ id: grantFunders.id }).from(grantFunders).where(eq(grantFunders.slug, slug)).limit(1)
  if (existing) return existing.id

  const type = opts.type && FUNDER_TYPES.includes(opts.type as (typeof FUNDER_TYPES)[number]) ? opts.type : 'other'
  const [created] = await db
    .insert(grantFunders)
    .values({ slug, name: clean, type, website: opts.website?.trim() || null })
    .returning({ id: grantFunders.id })
  return created?.id ?? null
}

// #endregion

// #region source counters

/**
 * Move a source's yield / reject tallies. These two numbers are the only way to
 * tell a discovery source that finds real grants from one that fills the queue
 * with press releases, so every moderation decision has to feed them.
 */
export async function bumpSourceCounter(sourceId: string | null | undefined, counter: 'yield' | 'reject') {
  if (!sourceId) return
  const db = getDb()
  const col = counter === 'yield' ? grantSources.yieldCount : grantSources.rejectCount
  await db
    .update(grantSources)
    .set({ [counter === 'yield' ? 'yieldCount' : 'rejectCount']: sql`${col} + 1`, updatedAt: new Date() })
    .where(eq(grantSources.id, sourceId))
}

// #endregion

// #region Brave budget

/**
 * The Brave Search monthly spend counter.
 *
 * SHARED KEY WITH THE WORKER. apps/worker/src/grants/brave.ts owns this
 * counter: it INCRs `grants:brave:spend:<UTC year>-<UTC month>` before every
 * request and reads the cap from BRAVE_MONTHLY_QUERY_CAP (default 1800). The
 * web app cannot import from apps/worker, so the key format and the default
 * cap are duplicated here and MUST be changed in both places together. If they
 * drift, this screen reports a budget that is not the one being enforced.
 */
const BRAVE_SPEND_KEY_PREFIX = 'grants:brave:spend:'
const BRAVE_DEFAULT_MONTHLY_CAP = 1800

export interface BraveBudgetView {
  used: number
  cap: number
  remaining: number
  /** The month the counter covers, e.g. "2026-08" (UTC, like the worker's). */
  month: string
}

function braveMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function braveCap(): number {
  const parsed = parseInt(process.env.BRAVE_MONTHLY_QUERY_CAP ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : BRAVE_DEFAULT_MONTHLY_CAP
}

/**
 * Read the current month's spend. Returns null when Redis cannot be reached,
 * which the screen renders as "unreadable" rather than as a comfortable zero:
 * an unknown budget is not the same as an unspent one.
 */
export async function readBraveBudget(): Promise<BraveBudgetView | null> {
  try {
    const month = braveMonth()
    const raw = await getRedis().get(`${BRAVE_SPEND_KEY_PREFIX}${month}`)
    const used = parseInt(raw ?? '0', 10) || 0
    const cap = braveCap()
    return { used, cap, remaining: Math.max(0, cap - used), month }
  } catch (err) {
    console.error('[admin/grants] could not read the Brave budget', err)
    return null
  }
}

// #endregion

// #region grant field parsing

export interface ParsedGrantFields {
  values: Partial<NewGrant>
  /** Funder name typed into the form, resolved by the caller. */
  funderName: string
  error?: string
}

function csv(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function int(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? '').replace(/[,$\s]/g, '')
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

function pick<T extends readonly string[]>(raw: FormDataEntryValue | null, allowed: T, fallback: T[number]): T[number] {
  const v = String(raw ?? '')
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback
}

/**
 * Read the grant fields out of a form. Used by both the new-grant editor that
 * a candidate opens into and the edit-an-existing-grant editor, so the two can
 * never validate differently.
 *
 * The geo check is not cosmetic: a state-scoped grant with no regions is
 * invisible to the matcher's rule-out test, so it would be offered to every
 * team in the country. Better to refuse the save.
 */
export function parseGrantFields(form: FormData): ParsedGrantFields {
  const name = String(form.get('name') ?? '').trim()
  const infoUrl = String(form.get('infoUrl') ?? '').trim()
  const geoScope = pick(form.get('geoScope'), GRANT_GEO_SCOPES, 'national')
  const countries = csv(form.get('countries')).map((c) => c.toUpperCase())
  const regions = csv(form.get('regions')).map((r) => r.toUpperCase())
  const programs = form.getAll('programs').map(String).filter((p) => (GRANT_PROGRAMS as readonly string[]).includes(p))
  const renewableRaw = String(form.get('renewable') ?? '')

  const values: Partial<NewGrant> = {
    name,
    summary: String(form.get('summary') ?? '').trim() || null,
    description: String(form.get('description') ?? '').trim() || null,
    infoUrl,
    applicationUrl: String(form.get('applicationUrl') ?? '').trim() || null,
    // How a team actually applies. Defaulting to 'online_form' would hide every
    // sponsor that wants a posted letter, and those are real, winnable grants.
    applyMethod: pick(form.get('applyMethod'), GRANT_APPLY_METHODS, 'unknown'),
    contactEmail: String(form.get('contactEmail') ?? '').trim() || null,
    mailingAddress: String(form.get('mailingAddress') ?? '').trim() || null,
    programs: programs.length > 0 ? programs : ['any'],
    geoScope,
    countries: countries.length > 0 ? countries : ['US'],
    regions,
    localityNote: String(form.get('localityNote') ?? '').trim() || null,
    awardMin: int(form.get('awardMin')),
    awardMax: int(form.get('awardMax')),
    awardCurrency: String(form.get('awardCurrency') ?? '').trim().toUpperCase() || 'USD',
    awardNotes: String(form.get('awardNotes') ?? '').trim() || null,
    // Tri-state on purpose: "we do not know if it renews" is a real answer and
    // is not the same as "it does not renew".
    renewable: renewableRaw === 'yes' ? true : renewableRaw === 'no' ? false : null,
    deadlineType: pick(form.get('deadlineType'), GRANT_DEADLINE_TYPES, 'unknown'),
    effortLevel: pick(form.get('effortLevel'), GRANT_EFFORT_LEVELS, 'unknown'),
    status: pick(form.get('status'), GRANT_STATUSES, 'pending'),
    updatedAt: new Date(),
  }

  const funderName = String(form.get('funderName') ?? '').trim()

  if (!name) return { values, funderName, error: 'Name is required.' }
  if (!/^https?:\/\//i.test(infoUrl)) return { values, funderName, error: 'Info URL must start with http:// or https://' }
  if (values.awardMin != null && values.awardMax != null && values.awardMin > values.awardMax) {
    return { values, funderName, error: 'Award minimum is larger than the maximum.' }
  }
  if (['state', 'region', 'local'].includes(geoScope) && regions.length === 0) {
    return {
      values,
      funderName,
      error: `A ${geoScope}-scoped grant needs at least one region code, otherwise the matcher cannot rule anyone out.`,
    }
  }
  return { values, funderName }
}

// #endregion

// #region change diffs

/**
 * How a `grant_changes.field` path maps onto a real column.
 *
 * The crawler files changes as dotted paths: `awardMax` for a column on the
 * grant, `cycle.<year>.<prop>` for one on that year's cycle. Applying a change
 * writes through this allowlist and nothing else. A path we do not recognise is
 * refused rather than guessed at, because the failure mode of a guess is a
 * wrong deadline on a public listing.
 */
export type ChangeValueType = 'text' | 'int' | 'bool' | 'date' | 'timestamp' | 'string_array'

export interface ChangeTarget {
  table: 'grant' | 'cycle'
  column: string
  type: ChangeValueType
  label: string
  /**
   * Sort weight in the review queue. 0 = a deadline moved, which is the change
   * a team actually loses money over, so it is never buried under a reworded
   * summary.
   */
  priority: 0 | 1 | 2
  /**
   * A change with no column behind it.
   *
   * The monitor files an `eligibilityText` change when a funder's eligibility
   * wording moves. That is worth a human's attention and there is nowhere to
   * write it: eligibility is not a grant column, it is rows in
   * grant_requirements. The field was absent from this map entirely, so the
   * screen told the reviewer "not a field this screen knows how to apply,
   * dismiss it and fix the extractor" for a change the extractor was right to
   * file. Producer and consumer disagreed, and the message blamed the producer.
   */
  advisory?: true
}

const GRANT_CHANGE_TARGETS: Record<string, ChangeTarget> = {
  name: { table: 'grant', column: 'name', type: 'text', label: 'Name', priority: 2 },
  summary: { table: 'grant', column: 'summary', type: 'text', label: 'Summary', priority: 2 },
  description: { table: 'grant', column: 'description', type: 'text', label: 'Description', priority: 2 },
  infoUrl: { table: 'grant', column: 'infoUrl', type: 'text', label: 'Info URL', priority: 1 },
  applicationUrl: { table: 'grant', column: 'applicationUrl', type: 'text', label: 'Application URL', priority: 1 },
  awardMin: { table: 'grant', column: 'awardMin', type: 'int', label: 'Award minimum', priority: 1 },
  awardMax: { table: 'grant', column: 'awardMax', type: 'int', label: 'Award maximum', priority: 1 },
  awardCurrency: { table: 'grant', column: 'awardCurrency', type: 'text', label: 'Currency', priority: 2 },
  awardNotes: { table: 'grant', column: 'awardNotes', type: 'text', label: 'Award notes', priority: 2 },
  renewable: { table: 'grant', column: 'renewable', type: 'bool', label: 'Renewable', priority: 2 },
  deadlineType: { table: 'grant', column: 'deadlineType', type: 'text', label: 'Deadline type', priority: 0 },
  effortLevel: { table: 'grant', column: 'effortLevel', type: 'text', label: 'Effort level', priority: 2 },
  geoScope: { table: 'grant', column: 'geoScope', type: 'text', label: 'Geographic scope', priority: 1 },
  countries: { table: 'grant', column: 'countries', type: 'string_array', label: 'Countries', priority: 1 },
  regions: { table: 'grant', column: 'regions', type: 'string_array', label: 'Regions', priority: 1 },
  localityNote: { table: 'grant', column: 'localityNote', type: 'text', label: 'Locality note', priority: 2 },
  programs: { table: 'grant', column: 'programs', type: 'string_array', label: 'Programs', priority: 1 },
  eligibilityText: {
    table: 'grant',
    // No column. See `advisory` above: the reviewer re-reads the requirements
    // and edits those rows, and this change is then dismissed.
    column: '',
    type: 'text',
    label: 'Eligibility wording',
    priority: 1,
    advisory: true,
  },
}

const CYCLE_CHANGE_TARGETS: Record<string, ChangeTarget> = {
  deadlineAt: { table: 'cycle', column: 'deadlineAt', type: 'timestamp', label: 'Deadline', priority: 0 },
  opensAt: { table: 'cycle', column: 'opensAt', type: 'date', label: 'Opens', priority: 0 },
  decisionAt: { table: 'cycle', column: 'decisionAt', type: 'date', label: 'Decision date', priority: 1 },
  deadlineNote: { table: 'cycle', column: 'deadlineNote', type: 'text', label: 'Deadline note', priority: 0 },
  status: { table: 'cycle', column: 'status', type: 'text', label: 'Cycle status', priority: 0 },
  amountNote: { table: 'cycle', column: 'amountNote', type: 'text', label: 'Cycle amount note', priority: 2 },
  sourceUrl: { table: 'cycle', column: 'sourceUrl', type: 'text', label: 'Cycle source URL', priority: 2 },
}

export interface ResolvedChangeField {
  target: ChangeTarget
  /** Only set for a cycle path. */
  cycleYear?: number
}

export function resolveChangeField(field: string): ResolvedChangeField | null {
  const parts = field.split('.')
  if (parts[0] === 'cycle') {
    if (parts.length !== 3) return null
    const year = parseInt(parts[1], 10)
    const target = CYCLE_CHANGE_TARGETS[parts[2]]
    if (!target || !Number.isFinite(year) || year < 2000 || year > 2100) return null
    return { target, cycleYear: year }
  }
  const target = GRANT_CHANGE_TARGETS[field]
  return target ? { target } : null
}

/**
 * Render a stored jsonb value for the diff.
 *
 * Timestamps print as the exact stored instant in UTC rather than the server's
 * local rendering, because "11:59pm ET" versus "11:59pm PT" is the entire point
 * of a deadline and a friendly relative date hides that difference.
 */
export function formatChangeValue(value: unknown, type: ChangeValueType): string {
  if (value === null || value === undefined || value === '') return '(none)'
  if (type === 'string_array') return Array.isArray(value) ? value.join(', ') : String(value)
  if (type === 'bool') return value === true || value === 'true' ? 'yes' : 'no'
  if (type === 'timestamp') {
    const d = new Date(String(value))
    return Number.isNaN(d.getTime()) ? `unparseable: ${String(value)}` : `${d.toISOString().replace('.000Z', 'Z')} (UTC)`
  }
  return String(value)
}

export type CoercedChange = { ok: true; value: string | number | boolean | string[] | Date | null } | { ok: false; error: string }

/** Turn a jsonb change value into something the column will accept, or refuse. */
export function coerceChangeValue(value: unknown, type: ChangeValueType): CoercedChange {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  switch (type) {
    case 'int': {
      const n = typeof value === 'number' ? value : parseInt(String(value).replace(/[,$\s]/g, ''), 10)
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `"${String(value)}" is not a number.` }
    }
    case 'bool':
      if (typeof value === 'boolean') return { ok: true, value }
      if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' }
      return { ok: false, error: `"${String(value)}" is not a yes/no value.` }
    case 'string_array':
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return { ok: true, value }
      return { ok: false, error: 'Expected a list of strings.' }
    case 'date': {
      const s = String(value).slice(0, 10)
      // drizzle `date()` columns take a plain YYYY-MM-DD string, so anything
      // looser is rejected instead of being coerced into a surprise timezone.
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { ok: true, value: s } : { ok: false, error: `"${String(value)}" is not a YYYY-MM-DD date.` }
    }
    case 'timestamp': {
      const d = new Date(String(value))
      return Number.isNaN(d.getTime()) ? { ok: false, error: `"${String(value)}" is not a date/time.` } : { ok: true, value: d }
    }
    default:
      return { ok: true, value: String(value) }
  }
}

// #endregion

// #region cycle parsing

export interface ParsedCycleFields {
  values: {
    cycleYear: number
    opensAt: string | null
    deadlineAt: Date | null
    deadlineNote: string | null
    decisionAt: string | null
    status: string
    amountNote: string | null
    sourceUrl: string | null
    isEstimated: boolean
  }
  error?: string
}

/**
 * Read one cycle's dates out of a form.
 *
 * The deadline is typed as a full ISO-8601 instant WITH an offset
 * (2027-03-01T23:59:00-05:00) rather than through a datetime-local input. A
 * datetime-local field hands the server a zoneless string, which then silently
 * picks up whatever zone the container is running in. Funders write "11:59pm
 * ET" and "5pm PT" and mean it, so the offset is typed out and checked.
 */
export function parseCycleFields(form: FormData): ParsedCycleFields {
  const year = parseInt(String(form.get('cycleYear') ?? ''), 10)
  const deadlineRaw = String(form.get('deadlineAt') ?? '').trim()
  const opensRaw = String(form.get('opensAt') ?? '').trim()
  const decisionRaw = String(form.get('decisionAt') ?? '').trim()

  const values: ParsedCycleFields['values'] = {
    cycleYear: year,
    opensAt: opensRaw || null,
    deadlineAt: null,
    deadlineNote: String(form.get('deadlineNote') ?? '').trim() || null,
    decisionAt: decisionRaw || null,
    status: pick(form.get('cycleStatus'), GRANT_CYCLE_STATUSES, 'unknown'),
    amountNote: String(form.get('amountNote') ?? '').trim() || null,
    sourceUrl: String(form.get('cycleSourceUrl') ?? '').trim() || null,
    isEstimated: form.get('isEstimated') === 'on',
  }

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return { values, error: 'Cycle year must be a four-digit year.' }
  }
  for (const [label, raw] of [
    ['Opens', opensRaw],
    ['Decision', decisionRaw],
  ] as const) {
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { values, error: `${label} date must be YYYY-MM-DD.` }
  }
  if (deadlineRaw) {
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(deadlineRaw)) {
      return { values, error: 'The deadline needs an explicit UTC offset, e.g. 2027-03-01T23:59:00-05:00 or ...Z.' }
    }
    const d = new Date(deadlineRaw)
    if (Number.isNaN(d.getTime())) return { values, error: `"${deadlineRaw}" is not a valid date and time.` }
    values.deadlineAt = d
  }
  return { values }
}

// #endregion

// #region requirement parsing

export interface ParsedRequirementFields {
  values: {
    kind: string
    operator: string
    value: string | number | boolean | string[] | null
    label: string
    isBlocking: boolean
    sortOrder: number
  }
  error?: string
}

/**
 * Read one requirement row out of a form.
 *
 * The value is typed as text and coerced here rather than being given three
 * separate inputs, because the operator already says what shape it must be:
 * `in` takes a list, `gte` takes a number, `exists` takes nothing at all. A
 * mismatch is refused instead of being stored as a string that the matcher
 * would then compare against a number and quietly fail.
 */
export function parseRequirementFields(form: FormData): ParsedRequirementFields {
  const kind = pick(form.get('kind'), GRANT_REQUIREMENT_KINDS, 'other')
  const operator = pick(form.get('operator'), GRANT_REQUIREMENT_OPERATORS, 'is')
  const raw = String(form.get('value') ?? '').trim()
  const label = String(form.get('label') ?? '').trim()
  const isBlocking = form.get('isBlocking') === 'on'
  const sortOrder = parseInt(String(form.get('sortOrder') ?? '0'), 10) || 0

  const values: ParsedRequirementFields['values'] = { kind, operator, value: null, label, isBlocking, sortOrder }

  if (!label) return { values, error: 'Give the requirement a label. It is the wording teams read.' }

  // 'other' is the bucket for anything the matcher cannot test. Letting it
  // block would rule teams out on a rule nothing ever evaluates, which is the
  // silent-exclusion failure the schema was shaped to avoid.
  if (kind === 'other' && isBlocking) {
    return { values, error: "Kind 'other' cannot be blocking. It renders as prose and is never tested." }
  }

  if (operator === 'exists') return { values }

  if (!raw) return { values, error: `Operator "${operator}" needs a value.` }

  if (operator === 'in' || operator === 'not_in') {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (list.length === 0) return { values, error: 'Give at least one comma-separated value.' }
    values.value = list
    return { values }
  }

  if (operator === 'gte' || operator === 'lte') {
    const n = Number(raw.replace(/[,$\s]/g, ''))
    if (!Number.isFinite(n)) return { values, error: `"${raw}" is not a number, and ${operator} compares numbers.` }
    values.value = n
    return { values }
  }

  // is / is_not. A bare true/false is a boolean and a bare number is a number,
  // because the profile fields they test (fiscal_sponsor_ok, team_age_years)
  // are stored that way. Everything else stays a string, so a region code like
  // "007" is not mangled into 7.
  if (raw === 'true' || raw === 'false') values.value = raw === 'true'
  else if (/^-?\d+(\.\d+)?$/.test(raw) && String(Number(raw)) === raw) values.value = Number(raw)
  else values.value = raw
  return { values }
}

/** Render a stored requirement value back into the single text input. */
export function requirementValueToInput(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

// #endregion

// #region form field parsing

export interface ParsedFormFieldFields {
  values: {
    fillKind: string
    paramName: string | null
    profilePath: string
    label: string | null
    notes: string | null
    sortOrder: number
  }
  error?: string
}

/**
 * Read one application-form prefill row out of a form.
 *
 * We cannot type into a form on someone else's site, so a prefill is a URL we
 * build. The checks below are the two ways that silently produces a broken
 * link: a prefill kind with no parameter name, and a Google Forms entry id
 * that is not actually an entry id. Both look fine in the admin and hand the
 * team a URL that drops their answers.
 */
export function parseFormFieldFields(form: FormData): ParsedFormFieldFields {
  const fillKind = pick(form.get('fillKind'), GRANT_FIELD_FILL_KINDS, 'copy')
  const paramName = String(form.get('paramName') ?? '').trim()
  const profilePath = String(form.get('profilePath') ?? '').trim()

  const values: ParsedFormFieldFields['values'] = {
    fillKind,
    paramName: paramName || null,
    profilePath,
    label: String(form.get('label') ?? '').trim() || null,
    notes: String(form.get('notes') ?? '').trim() || null,
    sortOrder: parseInt(String(form.get('sortOrder') ?? '0'), 10) || 0,
  }

  if (!profilePath) return { values, error: 'Profile path is required, e.g. teamNumber or contact.email.' }
  if (fillKind !== 'copy' && !paramName) {
    return { values, error: `Fill kind "${fillKind}" builds a URL, so it needs a parameter name.` }
  }
  if (fillKind === 'google_form_entry' && !/^entry\.\d+$/.test(paramName)) {
    return { values, error: 'A Google Forms parameter looks like entry.1234567890. Read it off the prefill link.' }
  }
  return { values }
}

// #endregion
