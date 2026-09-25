/**
 * Request shape for /api/internal/queue-decisions, and its validation. Pure: no
 * database, so the shape can be unit tested. The route dispatches each parsed
 * decision to the same body the admin button runs.
 */

export const MAX_QUEUE_DECISIONS = 200

export type QueueDecision =
  | { kind: 'album'; id: string; action: 'approve'; eventKey: string }
  | { kind: 'album'; id: string; action: 'suppress'; reason?: string }
  | { kind: 'grant'; id: string; action: 'suppress'; reason: string; rejectionKind?: string }
  | { kind: 'grant'; id: string; action: 'flag'; note: string }
  | { kind: 'grant'; id: string; action: 'duplicate'; grantRef?: string }
  | { kind: 'grant'; id: string; action: 'route' }
  | { kind: 'grant'; id: string; action: 'attach'; grantRef: string }
  | {
      kind: 'grant'
      id: string
      action: 'publish'
      overrides?: Record<string, string>
      overrideVerification?: string
      status?: 'published' | 'pending'
    }
  | { kind: 'grant_change'; id: string; action: 'apply' }
  | { kind: 'grant_change'; id: string; action: 'dismiss'; note?: string }
  | { kind: 'event_candidate'; id: string; action: 'accept'; values?: Record<string, string> }
  | { kind: 'event_candidate'; id: string; action: 'attach'; listingRef: string }
  | { kind: 'event_candidate'; id: string; action: 'duplicate'; listingRef?: string }
  | { kind: 'event_candidate'; id: string; action: 'suppress'; reason: string }

/**
 * The field names the event candidate review form posts
 * (app/admin/event-listings/candidates/page.tsx, plus the pin's hidden
 * latitude/longitude). An accept's `values` may carry only these, so a typo
 * fails the request instead of vanishing. A key left out keeps what the reader
 * extracted; a key sent as '' clears it, as an emptied box does.
 */
export const EVENT_CANDIDATE_VALUE_KEYS = [
  'name',
  'program',
  'hostTeamNumber',
  'startDate',
  'endDate',
  'days',
  'capacity',
  'costUsd',
  'costNote',
  'eventStatus',
  'registrationStatus',
  'registrationOpensAt',
  'registrationClosesAt',
  'volunteerStatus',
  'venueName',
  'address',
  'city',
  'region',
  'country',
  'website',
  'registrationUrl',
  'volunteerUrl',
  'teamListUrl',
  'chiefDelphiUrl',
  'contactEmail',
  'tbaKey',
  'parallelDivisions',
  'notes',
  'latitude',
  'longitude',
] as const

const EVENT_VALUE_KEY_SET: ReadonlySet<string> = new Set(EVENT_CANDIDATE_VALUE_KEYS)

export interface QueueDecisionResult {
  id: string
  kind: QueueDecision['kind']
  action: QueueDecision['action']
  ok: boolean
  error?: string
  slug?: string
  label?: string
  queued?: boolean
  /** event_candidate accept: the listing written, published or not. */
  listingId?: string
  /** event_candidate accept: set when the listing was saved but not published, naming what is missing. */
  pending?: string
}

export type ParsedQueueRequest = { actorName: string; decisions: QueueDecision[] } | { error: string }

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const nonEmpty = (v: unknown): string | undefined => {
  const s = str(v)?.trim()
  return s ? s : undefined
}

/** One decision, or the reason it is malformed. */
export function parseQueueDecision(raw: unknown): QueueDecision | { error: string } {
  if (!isObj(raw)) return { error: 'not an object' }
  const id = nonEmpty(raw.id)
  if (!id) return { error: 'id is required' }
  const optional = (key: string): string | undefined | false => {
    if (raw[key] === undefined || raw[key] === null) return undefined
    return str(raw[key]) ?? false
  }

  if (raw.kind === 'album') {
    if (raw.action === 'approve') {
      const eventKey = nonEmpty(raw.eventKey)
      if (!eventKey) return { error: 'album approve needs eventKey' }
      return { kind: 'album', id, action: 'approve', eventKey }
    }
    if (raw.action === 'suppress') {
      const reason = optional('reason')
      if (reason === false) return { error: 'reason must be a string' }
      return { kind: 'album', id, action: 'suppress', reason }
    }
    return { error: `unknown album action ${JSON.stringify(raw.action)}` }
  }

  if (raw.kind === 'grant') {
    switch (raw.action) {
      case 'suppress': {
        const reason = nonEmpty(raw.reason)
        if (!reason) return { error: 'grant suppress needs reason' }
        const rejectionKind = optional('rejectionKind')
        if (rejectionKind === false) return { error: 'rejectionKind must be a string' }
        return { kind: 'grant', id, action: 'suppress', reason, rejectionKind }
      }
      case 'flag': {
        const note = nonEmpty(raw.note)
        if (!note) return { error: 'grant flag needs note' }
        return { kind: 'grant', id, action: 'flag', note }
      }
      case 'duplicate': {
        const grantRef = optional('grantRef')
        if (grantRef === false) return { error: 'grantRef must be a string' }
        return { kind: 'grant', id, action: 'duplicate', grantRef }
      }
      case 'route':
        return { kind: 'grant', id, action: 'route' }
      case 'attach': {
        const grantRef = nonEmpty(raw.grantRef)
        if (!grantRef) return { error: 'grant attach needs grantRef' }
        return { kind: 'grant', id, action: 'attach', grantRef }
      }
      case 'publish': {
        let overrides: Record<string, string> | undefined
        if (raw.overrides !== undefined && raw.overrides !== null) {
          if (!isObj(raw.overrides)) return { error: 'overrides must be an object of strings' }
          overrides = {}
          for (const [k, v] of Object.entries(raw.overrides)) {
            if (typeof v !== 'string') return { error: `overrides.${k} must be a string` }
            // The gate bypass has its own named field so it is never smuggled
            // in with the facts.
            if (k === 'overrideVerification') return { error: 'use overrideVerification, not overrides.overrideVerification' }
            overrides[k] = v
          }
        }
        const overrideVerification = optional('overrideVerification')
        if (overrideVerification === false) return { error: 'overrideVerification must be a string' }
        let status: 'published' | 'pending' | undefined
        if (raw.status !== undefined && raw.status !== null) {
          if (raw.status !== 'published' && raw.status !== 'pending') return { error: "status must be 'published' or 'pending'" }
          status = raw.status
        }
        return {
          kind: 'grant',
          id,
          action: 'publish',
          overrides,
          overrideVerification: overrideVerification?.trim() || undefined,
          status,
        }
      }
      default:
        return { error: `unknown grant action ${JSON.stringify(raw.action)}` }
    }
  }

  if (raw.kind === 'grant_change') {
    if (raw.action === 'apply') return { kind: 'grant_change', id, action: 'apply' }
    if (raw.action === 'dismiss') {
      const note = optional('note')
      if (note === false) return { error: 'note must be a string' }
      return { kind: 'grant_change', id, action: 'dismiss', note }
    }
    return { error: `unknown grant_change action ${JSON.stringify(raw.action)}` }
  }

  if (raw.kind === 'event_candidate') {
    switch (raw.action) {
      case 'accept': {
        let values: Record<string, string> | undefined
        if (raw.values !== undefined && raw.values !== null) {
          if (!isObj(raw.values)) return { error: 'values must be an object of strings' }
          values = {}
          for (const [k, v] of Object.entries(raw.values)) {
            if (!EVENT_VALUE_KEY_SET.has(k)) return { error: `unknown values key ${JSON.stringify(k)}` }
            if (typeof v !== 'string') return { error: `values.${k} must be a string` }
            values[k] = v
          }
        }
        return { kind: 'event_candidate', id, action: 'accept', values }
      }
      case 'attach': {
        const listingRef = nonEmpty(raw.listingRef)
        if (!listingRef) return { error: 'event_candidate attach needs listingRef' }
        return { kind: 'event_candidate', id, action: 'attach', listingRef }
      }
      case 'duplicate': {
        const listingRef = optional('listingRef')
        if (listingRef === false) return { error: 'listingRef must be a string' }
        return { kind: 'event_candidate', id, action: 'duplicate', listingRef }
      }
      case 'suppress': {
        const reason = nonEmpty(raw.reason)
        if (!reason) return { error: 'event_candidate suppress needs reason' }
        return { kind: 'event_candidate', id, action: 'suppress', reason }
      }
      default:
        return { error: `unknown event_candidate action ${JSON.stringify(raw.action)}` }
    }
  }

  return { error: `unknown kind ${JSON.stringify(raw.kind)}` }
}

/** The whole request. Any malformed decision fails the request (400) before anything runs. */
export function parseQueueRequest(body: unknown): ParsedQueueRequest {
  if (!isObj(body)) return { error: 'Body must be a JSON object.' }
  const actorName = isObj(body.actor) ? nonEmpty(body.actor.name) : undefined
  if (!actorName) return { error: 'actor.name is required.' }
  if (!Array.isArray(body.decisions)) return { error: 'decisions must be an array.' }
  if (body.decisions.length > MAX_QUEUE_DECISIONS) {
    return { error: `At most ${MAX_QUEUE_DECISIONS} decisions per request, got ${body.decisions.length}.` }
  }
  const decisions: QueueDecision[] = []
  for (const [i, raw] of body.decisions.entries()) {
    const parsed = parseQueueDecision(raw)
    if ('error' in parsed) return { error: `decisions[${i}]: ${parsed.error}` }
    decisions.push(parsed)
  }
  return { actorName: actorName.slice(0, 80), decisions }
}

/**
 * The publish form's extra fields. `programs` is a comma list and REPLACES the
 * defaults' programs (the form field is multi-valued); everything else is set
 * over the defaults as the review deck would post it.
 */
export function publishFormExtras(d: Extract<QueueDecision, { action: 'publish' }>): {
  extra: Record<string, string>
  programs?: string[]
} {
  const { programs, ...rest } = d.overrides ?? {}
  const extra: Record<string, string> = {
    status: d.status ?? 'published',
    ...rest,
    ...(d.overrideVerification ? { overrideVerification: d.overrideVerification } : {}),
  }
  return {
    extra,
    programs: programs === undefined ? undefined : programs.split(',').map((p) => p.trim()).filter(Boolean),
  }
}
