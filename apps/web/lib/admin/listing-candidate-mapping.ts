/**
 * What an accepted candidate becomes.
 *
 * Kept apart from listing-discovery.ts, which holds the queue handle and the
 * database writes, because these two functions are pure and are the part worth
 * pinning with a test: they decide which crawler-read values are trusted onto
 * a row and which are dropped for a person to fill in.
 *
 * The rule they enforce is the same one the connectors follow. A value the
 * connector was not sure of is absent, and absent stays absent. An unparseable
 * date, a URL that is not a URL, a day count that is not 1 or 2: all dropped,
 * because a blank is a question a reviewer will answer and a wrong value is one
 * they will not think to ask.
 */
import { EVENT_PROGRAMS } from '@the-tool-pit/db/event-enums'
import { FIELD_PROGRAMS } from '@the-tool-pit/db/field-enums'
import type {
  EventListingCandidate,
  ExtractedEventListingFields,
  ExtractedPracticeFieldFields,
  NewEventListing,
  NewPracticeField,
  PracticeFieldCandidate,
} from '@the-tool-pit/db'

/** Trimmed, or null. Empty strings are absent values, not values. */
function text(v: string | undefined | null): string | null {
  const clean = v?.trim()
  return clean ? clean : null
}

/** Only an http(s) URL survives. A connector that emitted junk does not get to write it. */
function url(v: string | undefined | null): string | null {
  const clean = text(v)
  if (!clean) return null
  return /^https?:\/\//i.test(clean) ? clean : null
}

/** ISO yyyy-mm-dd or nothing. A half-parsed date is worse than no date. */
function isoDate(v: string | undefined | null): string | null {
  const clean = text(v)
  if (!clean) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null
}

function teamNumber(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 100_000 ? v : null
}

function program(v: string | undefined, allowed: readonly string[]): string {
  return v && allowed.includes(v) ? v : 'frc'
}

/**
 * Build the event_listings row an accepted candidate becomes.
 *
 * Everything comes off `extracted`, which is the deterministic half of a
 * candidate. `raw_metadata` is evidence for the reviewer and never lands in a
 * row. Coordinates are deliberately absent: the map pin is a human's call and
 * approveEvent() refuses to publish without one, which is the second half of
 * the gate.
 */
export function eventListingFromCandidate(
  candidate: Pick<EventListingCandidate, 'sourceUrl' | 'tbaKey' | 'extracted'>,
  name: string,
): NewEventListing {
  const ex = (candidate.extracted ?? {}) as ExtractedEventListingFields
  // A candidate found on the forum keeps its thread even when the connector did
  // not read a chiefDelphiUrl out of the post, because the thread IS the only
  // pointer a lot of these events have.
  const cdFallback = /^https?:\/\/(www\.)?chiefdelphi\.com\//i.test(candidate.sourceUrl) ? candidate.sourceUrl : null
  const days = ex.days === 1 || ex.days === 2 ? ex.days : null

  return {
    name,
    program: program(ex.program, EVENT_PROGRAMS),
    hostTeamNumber: teamNumber(ex.hostTeamNumber),
    venueName: text(ex.venueName),
    address: text(ex.address),
    city: text(ex.city),
    region: text(ex.region),
    country: text(ex.country),
    startDate: isoDate(ex.startDate),
    endDate: isoDate(ex.endDate),
    days,
    website: url(ex.website),
    registrationUrl: url(ex.registrationUrl),
    chiefDelphiUrl: url(ex.chiefDelphiUrl) ?? cdFallback,
    tbaKey: text(ex.tbaKey ?? candidate.tbaKey)?.toLowerCase() ?? null,
    source: 'scrape',
    status: 'pending',
  }
}

/**
 * Build the practice_fields row an accepted candidate becomes.
 *
 * The spec columns (coverage, perimeter, elements, FMS, ceiling) are NOT set
 * here and land on their column defaults, because a thread saying "full field"
 * may be describing the field the poster wants rather than the one on offer.
 * Those mentions stay in rawMetadata.signals as evidence and a reviewer sets
 * the spec by hand before publishing.
 */
export function practiceFieldFromCandidate(
  candidate: Pick<PracticeFieldCandidate, 'teamNumber' | 'extracted'>,
  name: string,
): NewPracticeField {
  const ex = (candidate.extracted ?? {}) as ExtractedPracticeFieldFields

  return {
    name,
    teamNumber: teamNumber(ex.teamNumber ?? candidate.teamNumber),
    teamName: text(ex.teamName),
    program: program(ex.program, FIELD_PROGRAMS),
    city: text(ex.city),
    region: text(ex.region),
    country: text(ex.country),
    website: url(ex.website),
    contactUrl: url(ex.contactUrl),
    source: 'scrape',
    status: 'pending',
  }
}

