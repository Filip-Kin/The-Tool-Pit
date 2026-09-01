/**
 * Shared, framework-agnostic display helpers for off-season event listings: the
 * pin colour scheme (keyed on REGISTRATION, because "can I still get in" is the
 * question a glance at the map has to answer), human labels for the enum-like
 * columns, date and cost and fullness formatting, and the public DTO shape.
 * Used by the map, list, card, legend, and admin. No React here.
 */
import type {
  EventStatus,
  RegistrationStatus,
  VolunteerStatus,
} from '@the-tool-pit/db'

/**
 * Public event shape sent to the client. Deliberately omits the private
 * submitter audit columns (name/contact/ip hash). Dates are ISO YYYY-MM-DD
 * strings, straight from the `date` columns.
 */
export interface PublicEvent {
  id: string
  program: string
  name: string
  hostTeamNumber: number | null
  latitude: number | null
  longitude: number | null
  venueName: string | null
  address: string | null
  city: string | null
  region: string | null
  country: string | null
  /**
   * The calendar year this listing belongs to. Null when it has no dates yet,
   * which is read as the current season, never as archived.
   */
  seasonYear: number | null
  /** Last year's listing, when this one renewed it. Null for a first listing. */
  previousListingId: string | null
  startDate: string | null
  endDate: string | null
  days: number | null
  parallelDivisions: boolean
  capacity: number | null
  costUsd: number | null
  costNote: string | null
  registrationStatus: RegistrationStatus
  registrationOpensAt: string | null
  volunteerStatus: VolunteerStatus
  eventStatus: EventStatus
  website: string | null
  registrationUrl: string | null
  volunteerUrl: string | null
  chiefDelphiUrl: string | null
  contactEmail: string | null
  notes: string | null
  tbaKey: string | null
  /** Team count from the latest approved roster snapshot (TBA or a vetted scrape). */
  registeredTeamCount: number | null
  teamCountUpdatedAt: string | null
}

// ---------------------------------------------------------------------------
// Season - the OTHER axis, and the one people confuse with timing
//
// TWO DIFFERENT QUESTIONS, and the UI has to keep them apart:
//
//   SEASON  "which year's offseason is this listing part of"
//   TIMING  "has this listing's weekend been and gone"
//
// The offseason season is the calendar year and it ends on 31 December, so on
// 1 January every listing from the year before becomes historical in one step.
// That is what `seasonScope` selects between: the year we are in, or the years
// that are finished.
//
// Timing is what the Upcoming / Past / All control selects between, and it only
// ever means "within the listings on screen". A Kettering Kickoff that ran last
// September is PAST inside the 2026 season and it is ARCHIVED once 2027 starts,
// and those are two separate facts about it.
//
// This module owns the season predicate rather than importing it from
// @the-tool-pit/db, because these functions are called from client components
// and the db barrel opens a database connection. The rule itself, and the
// migration that backfills it, live in packages/db/src/schema/event-listings.ts.
// ---------------------------------------------------------------------------

/** Which years of listings are on screen. */
export type SeasonScope = 'current' | 'earlier'

/**
 * True when this listing belongs to a finished season.
 *
 * A null season is never archived: a listing with no dates yet is one somebody
 * is still putting together, and it stays on the map.
 */
export function isArchivedListing(
  ev: Pick<PublicEvent, 'seasonYear'>,
  currentSeason: number,
): boolean {
  return ev.seasonYear != null && ev.seasonYear < currentSeason
}

/**
 * Split a mixed list into the seasons that are live and the seasons that are
 * finished. Used to check the server filter from a test and to label a view
 * that turned out to hold more than one year.
 */
export function partitionBySeason(
  events: PublicEvent[],
  currentSeason: number,
): { current: PublicEvent[]; earlier: PublicEvent[] } {
  const current: PublicEvent[] = []
  const earlier: PublicEvent[] = []
  for (const ev of events) (isArchivedListing(ev, currentSeason) ? earlier : current).push(ev)
  return { current, earlier }
}

/**
 * The distinct seasons present, newest first. Drives the "2026 and 2025" line
 * on the earlier-years view, so the reader is told which years they are looking
 * at rather than having to read every card's date.
 */
export function seasonsPresent(events: Pick<PublicEvent, 'seasonYear'>[]): number[] {
  const years = new Set<number>()
  for (const ev of events) if (ev.seasonYear != null) years.add(ev.seasonYear)
  return [...years].sort((a, b) => b - a)
}

/** "2026", "2026 and 2025", "2026 to 2023". Empty string when no year is known. */
export function seasonRangeLabel(years: number[]): string {
  if (years.length === 0) return ''
  if (years.length === 1) return String(years[0])
  if (years.length === 2) return `${years[0]} and ${years[1]}`
  return `${years[0]} to ${years[years.length - 1]}`
}

// ---------------------------------------------------------------------------
// Timing - the axis the whole vertical turns on
// ---------------------------------------------------------------------------

export type EventTiming = 'soon' | 'upcoming' | 'past'

/** Days from `now` until the event's start (negative once it has started). */
export function daysUntil(ev: Pick<PublicEvent, 'startDate'>, now: Date): number | null {
  if (!ev.startDate) return null
  const start = new Date(`${ev.startDate}T00:00:00`)
  const ms = start.getTime() - now.getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

/** How soon a shooting-distance from now. Uses endDate so a 2-day event stays "on" through day two. */
export const SOON_DAYS = 30

export function eventTiming(ev: PublicEvent, now: Date): EventTiming {
  // An event is "past" once its last day is over. Fall back to startDate.
  const lastDay = ev.endDate ?? ev.startDate
  if (!lastDay) return 'upcoming'
  const end = new Date(`${lastDay}T23:59:59`)
  if (end.getTime() < now.getTime()) return 'past'
  const d = daysUntil(ev, now)
  return d != null && d <= SOON_DAYS ? 'soon' : 'upcoming'
}

/**
 * Where an event sits in its life: "Cancelled", "Completed", "Happening now",
 * "In 11 days", or its plain status.
 *
 * Lived in event-card.tsx, which meant the map tooltip had no way to say any of
 * it. A pin's colour cannot: grey means past OR cancelled OR nobody has told us
 * the registration state, so the one thing the tooltip most needed to say was
 * the one thing the pin could not. Shared from here so the card and the map say
 * the same words about the same event.
 */
export function timingPhrase(ev: PublicEvent, now: Date): string {
  if (ev.eventStatus === 'cancelled') return 'Cancelled'
  const timing = eventTiming(ev, now)
  const d = daysUntil(ev, now)
  if (timing === 'past') return 'Completed'
  if (d == null) return EVENT_STATUS_LABEL[ev.eventStatus]
  if (d <= 0) return 'Happening now'
  if (d === 1) return 'Tomorrow'
  if (d <= 45) return `In ${d} days`
  return EVENT_STATUS_LABEL[ev.eventStatus]
}

// ---------------------------------------------------------------------------
// Pin colour scheme: hue = registration state. Every card already carries the
// date, so timing is not what the colour has to tell you. Whether you can sign
// up is. Size backs the colour up: the pins you can act on are the big ones.
// ---------------------------------------------------------------------------

export interface MarkerStyle {
  /** A CSS colour. A var(), because each of these has a light value too. */
  color: string
  size: number
}

// Each colour is a token rather than a hex, because the light theme needs its
// own value for every one of them: on a pale basemap the amber and the grey
// both drop under the 3:1 a pin has to hold against what is behind it. The
// tokens are defined in app/globals.css, once per theme. Kept as var() strings
// rather than resolved here so a pin repaints when the theme changes without
// the map being told anything.
const OPEN = 'var(--color-reg-open)' // brand accent - taking registrations now
const NOT_OPEN_YET = 'var(--color-reg-soon)' // same family as open, because it
                               // WILL open. Not amber and not red: neither
                               // "something is wrong" nor "you missed it".
const WAITLIST = 'var(--color-reg-waitlist)' // amber - full, but you can still get in line
const CLOSED = 'var(--color-reg-closed)' // error red - the door is shut
const MOOT = 'var(--color-reg-moot)' // grey - already run, cancelled, or nobody has told us

export function eventMarkerStyle(ev: PublicEvent, now: Date): MarkerStyle {
  // Once an event is off the table there is nothing to register for, so a
  // cancelled or finished event never wears the open or closed colours.
  if (ev.eventStatus === 'cancelled' || eventTiming(ev, now) === 'past') return { color: MOOT, size: 13 }
  switch (ev.registrationStatus) {
    case 'open':
      return { color: OPEN, size: 20 }
    case 'not_open':
      return { color: NOT_OPEN_YET, size: 17 }
    case 'waitlist':
      return { color: WAITLIST, size: 15 }
    case 'closed':
      return { color: CLOSED, size: 14 }
    default:
      return { color: MOOT, size: 13 }
  }
}

// ---------------------------------------------------------------------------
// Fullness - registered teams against capacity
// ---------------------------------------------------------------------------

/** Ratio in [0,1] of registered teams to capacity, or null if either is missing. */
export function fullnessRatio(ev: Pick<PublicEvent, 'registeredTeamCount' | 'capacity'>): number | null {
  if (ev.registeredTeamCount == null || !ev.capacity) return null
  return Math.min(1, ev.registeredTeamCount / ev.capacity)
}

/**
 * A short fullness phrase for a card or popup:
 *   "24 / 32 teams" when we have a count, "32 team slots" with only capacity,
 *   null when we know neither.
 */
export function fullnessLabel(ev: Pick<PublicEvent, 'registeredTeamCount' | 'capacity'>): string | null {
  if (ev.registeredTeamCount != null && ev.capacity) return `${ev.registeredTeamCount} / ${ev.capacity} teams`
  if (ev.registeredTeamCount != null) return `${ev.registeredTeamCount} teams registered`
  if (ev.capacity) return `${ev.capacity} team slots`
  return null
}

// ---------------------------------------------------------------------------
// Dates + cost
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDay(iso: string): { m: number; d: number; y: number } {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  return { m: (m ?? 1) - 1, d: d ?? 1, y: y ?? 0 }
}

/** "12 - 13 Sep 2026", "1 Aug 2026", or "" when there is no date. */
export function eventDateRange(ev: Pick<PublicEvent, 'startDate' | 'endDate'>): string {
  if (!ev.startDate) return ''
  const s = fmtDay(ev.startDate)
  if (!ev.endDate || ev.endDate === ev.startDate) return `${s.d} ${MONTHS[s.m]} ${s.y}`
  const e = fmtDay(ev.endDate)
  // Same month: "12 - 13 Sep 2026". Different month: "30 Aug - 1 Sep 2026".
  if (s.m === e.m && s.y === e.y) return `${s.d} - ${e.d} ${MONTHS[s.m]} ${s.y}`
  if (s.y === e.y) return `${s.d} ${MONTHS[s.m]} - ${e.d} ${MONTHS[e.m]} ${s.y}`
  return `${s.d} ${MONTHS[s.m]} ${s.y} - ${e.d} ${MONTHS[e.m]} ${e.y}`
}

/** "$300", "$300 · $450 for both days", "Free", or null when cost is unknown. */
export function costLabel(ev: Pick<PublicEvent, 'costUsd' | 'costNote'>): string | null {
  const base = ev.costUsd == null ? null : ev.costUsd === 0 ? 'Free' : `$${ev.costUsd}`
  if (base && ev.costNote) return `${base} · ${ev.costNote}`
  if (base) return base
  return ev.costNote ?? null
}

// ---------------------------------------------------------------------------
// Distance / proximity (for "near me" sorting) - same maths as the field map.
// ---------------------------------------------------------------------------

export type DistanceUnit = 'mi' | 'km'

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const MILE_REGIONS = new Set(['US', 'GB', 'MM', 'LR'])

export function unitFromLocale(locale: string | undefined): DistanceUnit {
  if (!locale) return 'km'
  const region = locale.split('-')[1]?.toUpperCase()
  return region && MILE_REGIONS.has(region) ? 'mi' : 'km'
}

export function formatDistance(km: number, unit: DistanceUnit): string {
  const value = unit === 'mi' ? km * 0.621371 : km
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded} ${unit}`
}

// ---------------------------------------------------------------------------
// Human labels
// ---------------------------------------------------------------------------

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  not_open: 'Not yet open',
  open: 'Registration open',
  waitlist: 'Waitlist',
  closed: 'Registration closed',
  unknown: 'Registration status unknown',
}

/** Short chip form of the registration state (no "Registration" prefix). */
export const REGISTRATION_STATUS_SHORT: Record<RegistrationStatus, string> = {
  not_open: 'Not yet open',
  open: 'Open',
  waitlist: 'Waitlist',
  closed: 'Closed',
  unknown: 'Unknown',
}

export const VOLUNTEER_STATUS_LABEL: Record<VolunteerStatus, string> = {
  open: 'Volunteers wanted',
  not_open: 'Volunteer sign-up not open',
  unknown: 'Volunteer status unknown',
}

/** A one-line location string from the parts we have. */
export function eventLocation(ev: Pick<PublicEvent, 'venueName' | 'city' | 'region' | 'country'>): string {
  return [ev.venueName, ev.city, ev.region, ev.country].filter(Boolean).join(', ')
}

/** Day-count phrase: "1 day", "2 days", "two 1-day events" for the parallel split. */
export function daysLabel(ev: Pick<PublicEvent, 'days' | 'parallelDivisions'>): string | null {
  if (ev.parallelDivisions) return `Two ${ev.days ?? 1}-day events`
  if (!ev.days) return null
  return ev.days === 1 ? '1 day' : `${ev.days} days`
}
