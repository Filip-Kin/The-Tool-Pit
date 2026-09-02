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
import { EVENT_PROGRAMS, REGISTRATION_STATUSES, VOLUNTEER_STATUSES } from '@the-tool-pit/db/event-enums'
import { cleanEventName } from '@the-tool-pit/db/event-name'
import {
  FIELD_PROGRAMS,
  FIELD_COVERAGE,
  FIELD_PERIMETER,
  FIELD_ELEMENTS,
  FIELD_AVAILABILITY,
} from '@the-tool-pit/db/field-enums'
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

/**
 * A coordinate inside its real range, or null.
 *
 * A latitude of 200 is not a place. The bound is per-axis because swapping the
 * two is the mistake this catches: a longitude in the latitude column reads as
 * a valid number and puts the pin in the sea.
 */
function coordinate(v: number | undefined | null, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null
}

/** A whole number, or null. Anything else the reader offered is not a count. */
function intOrNull(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
}

/** A value that is in the tuple, or undefined so the column default applies. */
function inEnum(v: string | undefined | null, allowed: readonly string[]): string | undefined {
  return v && allowed.includes(v) ? v : undefined
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

  // Days that PLAY QUALIFICATION OR PLAYOFF MATCHES. Nothing else counts, and
  // it cannot be derived from the dates.
  //
  // Setup, load-in, pit hours and inspection do not count, and neither do
  // practice matches, even though matches are played. The combinations vary
  // and no rule of thumb survives them: one day can hold load-in and the whole
  // competition; setup and load-in can take a day each before a single
  // competition day; a three-day span can be one competition day or two.
  //
  // So this is READ, not computed. The one span that is safe is a single date:
  // an event listed on one day plays its matches on that day, because a
  // separate setup day would have made the span two. A span of two is exactly
  // the case that breaks a derivation, since it is as likely to be setup plus
  // one competition day as it is two competition days.
  const start = isoDate(ex.startDate)
  const end = isoDate(ex.endDate)
  const spanned = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : null
  const days = ex.days === 1 || ex.days === 2 ? ex.days : spanned === 1 ? 1 : null

  return {
    // Cleaned even when the reader already did it, because a candidate read
    // before that instruction existed still carries the whole thread title,
    // and re-reading fifty events to fix punctuation is not a good use of a
    // model budget.
    name: cleanEventName(name),
    // The season is the calendar year the dates fall in, which is what makes
    // the year redundant in the name. It was never set here, so every accepted
    // candidate landed with a null season and the map's year filter could not
    // see it.
    seasonYear: start ? Number(start.slice(0, 4)) : null,
    program: program(ex.program, EVENT_PROGRAMS),
    hostTeamNumber: teamNumber(ex.hostTeamNumber),
    // Looked up from the venue during the read, so accepting puts the event on
    // the map instead of handing the reviewer a school to find themselves.
    latitude: coordinate(ex.latitude, 90),
    longitude: coordinate(ex.longitude, 180),
    venueName: text(ex.venueName),
    address: text(ex.address),
    city: text(ex.city),
    region: text(ex.region),
    country: text(ex.country),
    startDate: start,
    endDate: end,
    days,
    // EVERYTHING THE READER FOUND, not a subset. This mapping listed eleven
    // fields and was written when `extracted` had eleven. The reader fills
    // twenty, so accepting a candidate quietly threw away the cost, the
    // capacity, the registration state, the volunteer link and the contact,
    // which are exactly the fields a person would otherwise retype by hand.
    capacity: intOrNull(ex.capacity),
    costUsd: intOrNull(ex.costUsd),
    costNote: text(ex.costNote),
    registrationStatus: inEnum(ex.registrationStatus, REGISTRATION_STATUSES) ?? 'unknown',
    volunteerStatus: inEnum(ex.volunteerStatus, VOLUNTEER_STATUSES) ?? 'unknown',
    contactEmail: text(ex.contactEmail),
    notes: text(ex.notes),
    website: url(ex.website),
    registrationUrl: url(ex.registrationUrl),
    volunteerUrl: url(ex.volunteerUrl),
    teamListUrl: url(ex.teamListUrl),
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
    latitude: coordinate(ex.latitude, 90),
    longitude: coordinate(ex.longitude, 180),
    program: program(ex.program, FIELD_PROGRAMS),
    address: text(ex.address),
    city: text(ex.city),
    region: text(ex.region),
    country: text(ex.country),
    // The spec, WHEN THE READER FOUND IT WITH A QUOTE BEHIND IT. The comment
    // above used to say these are never set, and it was right about a regex:
    // "full field" in a thread may be what the poster wants. It is not right
    // about a reader that quotes the sentence, and a reviewer sees that
    // sentence next to the value before publishing.
    coverage: inEnum(ex.coverage, FIELD_COVERAGE) ?? undefined,
    perimeter: inEnum(ex.perimeter, FIELD_PERIMETER) ?? undefined,
    elements: inEnum(ex.elements, FIELD_ELEMENTS) ?? undefined,
    availability: inEnum(ex.availability, FIELD_AVAILABILITY) ?? undefined,
    hasFms: typeof ex.hasFms === 'boolean' ? ex.hasFms : undefined,
    ceilingHeightFt: intOrNull(ex.ceilingHeightFt),
    hours: text(ex.hours),
    contactInfo: text(ex.contactInfo),
    notes: text(ex.notes),
    website: url(ex.website),
    contactUrl: url(ex.contactUrl),
    source: 'scrape',
    status: 'pending',
  }
}

