/**
 * The off-season map's filter set: how far, how much, which team, second
 * robots, and which dates. Framework-agnostic, like event-display.ts, so the
 * predicate can be unit tested without rendering the explorer.
 *
 * THE RULE FOR MISSING DATA IS THE SAME EVERYWHERE HERE: a filter that names a
 * limit only keeps events we can check against it. An event with no price is
 * not kept by "up to $300", because nobody has said it costs less; an event
 * with no published roster is not kept by "team 4145"; an event with no dates
 * is not kept by a date range. Filtering is a promise about what is on screen,
 * and letting unchecked rows through breaks it.
 *
 * That rule hides real events, so every control that can hide one reports how
 * many it hid. See FILTER_HINTS below and the counts the menu renders.
 */
import type { PublicEvent } from './event-display'

export interface EventFilters {
  /** Kilometres from the reader. Null when off. Always stored in km; the UI converts. */
  maxDistanceKm: number | null
  /** Whole US dollars per team, inclusive. Null when off. Zero means free only. */
  maxCostUsd: number | null
  /** A FIRST team number whose roster entry the event must carry. Null when off. */
  teamNumber: number | null
  /** ISO yyyy-mm-dd, inclusive. '' when off. */
  from: string
  /** ISO yyyy-mm-dd, inclusive. '' when off. */
  to: string
}

export const NO_FILTERS: EventFilters = {
  maxDistanceKm: null,
  maxCostUsd: null,
  teamNumber: null,
  from: '',
  to: '',
}

/**
 * What the reader has to know to judge one event against the filters, beyond
 * the event itself: how far away it is (the explorer already computes this for
 * its distance sort) and which teams are on its roster.
 */
export interface FilterContext {
  /** Distance in km, or null when the event has no coordinates or the reader has no location. */
  km: number | null
  /** Team numbers on the latest approved roster, or null when there is no published roster. */
  rosterTeams: number[] | null
}

/**
 * How many filters are on. The date range counts once, however many of its two
 * ends are set, because the reader set one thing.
 */
export function activeFilterCount(f: EventFilters): number {
  let n = 0
  if (f.maxDistanceKm != null) n++
  if (f.maxCostUsd != null) n++
  if (f.teamNumber != null) n++
  if (f.from || f.to) n++
  return n
}

export function hasActiveFilters(f: EventFilters): boolean {
  return activeFilterCount(f) > 0
}

/** The last day the event runs, falling back to its first when it has only one date. */
function lastDay(ev: Pick<PublicEvent, 'startDate' | 'endDate'>): string | null {
  return ev.endDate ?? ev.startDate
}

/**
 * True when the event's run overlaps the range, so a two-day event that starts
 * the day before the range still counts as being in it. ISO yyyy-mm-dd sorts
 * lexicographically, so these are plain string comparisons.
 */
export function matchesDateRange(
  ev: Pick<PublicEvent, 'startDate' | 'endDate'>,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true
  if (!ev.startDate) return false
  if (from && (lastDay(ev) ?? ev.startDate) < from) return false
  if (to && ev.startDate > to) return false
  return true
}

/** Whether one event survives the whole filter set. */
export function matchesEventFilters(
  ev: PublicEvent,
  f: EventFilters,
  ctx: FilterContext,
): boolean {
  if (f.maxDistanceKm != null && (ctx.km == null || ctx.km > f.maxDistanceKm)) return false
  if (f.maxCostUsd != null && (ev.costUsd == null || ev.costUsd > f.maxCostUsd)) return false
  if (f.teamNumber != null && !(ctx.rosterTeams ?? []).includes(f.teamNumber)) return false
  if (!matchesDateRange(ev, f.from, f.to)) return false
  return true
}

/**
 * How many of these events a given filter cannot judge, so the menu can say
 * "4 events don't list a price" instead of leaving the reader to wonder where
 * they went. Counted over the events the OTHER controls already allow, which is
 * what the explorer passes in.
 */
export function unjudgeableCounts(
  events: PublicEvent[],
  rosterTeams: Record<string, number[]>,
): { noCost: number; noRoster: number; noDates: number } {
  let noCost = 0
  let noRoster = 0
  let noDates = 0
  for (const ev of events) {
    if (ev.costUsd == null) noCost++
    if (!rosterTeams[ev.id]?.length) noRoster++
    if (!ev.startDate) noDates++
  }
  return { noCost, noRoster, noDates }
}
