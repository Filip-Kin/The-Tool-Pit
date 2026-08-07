/**
 * Shared, framework-agnostic display helpers for practice fields: the pin
 * colour scheme, human labels for the enum-like columns, and the public DTO
 * shape. Used by the map, list, card, legend, and admin. No React here.
 */
import type { FieldCoverage, FieldElements, FieldAvailability, FieldPerimeter } from '@the-tool-pit/db'

/**
 * Public field shape sent to the client. Deliberately omits the private
 * submitter audit columns (name/contact/ip hash).
 */
export interface PublicField {
  id: string
  teamNumber: number | null
  teamName: string | null
  program: string
  name: string
  latitude: number | null
  longitude: number | null
  address: string | null
  city: string | null
  region: string | null
  country: string | null
  coverage: FieldCoverage
  perimeter: FieldPerimeter
  elements: FieldElements
  hasFms: boolean
  aprilTags: boolean
  ceilingHeightFt: number | null
  availability: FieldAvailability
  hours: string | null
  contactInfo: string | null
  contactUrl: string | null
  website: string | null
  notes: string | null
  photoUrl: string | null
}

// ---------------------------------------------------------------------------
// Pin colour scheme: hue = element type (amber wood / green official),
// depth = coverage (deep full / pale half), white ring = FMS.
// ---------------------------------------------------------------------------

export interface MarkerStyle {
  /** Fill colour of the marker. */
  color: string
  /** Diameter in px. */
  size: number
}

// FRC colours: official elements = blue, wood elements = red; the half-field
// variant is lightened toward white. (FMS is not shown on the map.)
const WOOD_FULL = '#e5484d' // FRC red
const WOOD_HALF = '#f2a6a8' // light red
const OFFICIAL_FULL = '#3b6fe0' // FRC blue
const OFFICIAL_HALF = '#a8c6f6' // light blue

export function fieldMarkerStyle(coverage: FieldCoverage, elements: FieldElements): MarkerStyle {
  const full = coverage === 'full'
  const color =
    elements === 'official' ? (full ? OFFICIAL_FULL : OFFICIAL_HALF) : full ? WOOD_FULL : WOOD_HALF
  return { color, size: full ? 20 : 16 }
}

// ---------------------------------------------------------------------------
// Distance / proximity (for "near me" sorting)
// ---------------------------------------------------------------------------

export type DistanceUnit = 'mi' | 'km'

/** Great-circle distance between two lat/lng points, in kilometres (haversine). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371 // Earth radius, km
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Locales that conventionally use miles for distance (everyone else: km).
const MILE_REGIONS = new Set(['US', 'GB', 'MM', 'LR'])

/** Pick a distance unit from a browser locale string (e.g. "en-US" -> mi). */
export function unitFromLocale(locale: string | undefined): DistanceUnit {
  if (!locale) return 'km'
  const region = locale.split('-')[1]?.toUpperCase()
  return region && MILE_REGIONS.has(region) ? 'mi' : 'km'
}

/** Format a kilometre distance in the given unit, rounded for readability. */
export function formatDistance(km: number, unit: DistanceUnit): string {
  const value = unit === 'mi' ? km * 0.621371 : km
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded} ${unit}`
}

/** Below this ceiling height (feet), warn that it may be too low to shoot. */
export const LOW_CEILING_FT = 12

/** True if a stated ceiling height is low enough to matter for shooting games. */
export function isLowCeiling(ft: number | null | undefined): ft is number {
  return typeof ft === 'number' && ft < LOW_CEILING_FT
}

/** Whether access is via a sign-up form (has a link) or by arranging with the team. */
export function accessLabel(f: Pick<PublicField, 'contactUrl'>): 'Sign-up form' | 'By arrangement' {
  return f.contactUrl ? 'Sign-up form' : 'By arrangement'
}

// ---------------------------------------------------------------------------
// Human labels
// ---------------------------------------------------------------------------

export const COVERAGE_LABEL: Record<FieldCoverage, string> = {
  full: 'Full field',
  half: 'Half field',
}

export const PERIMETER_LABEL: Record<FieldPerimeter, string> = {
  wood: 'Wood perimeter',
  metal: 'Metal perimeter',
  none: 'No perimeter',
}

export const ELEMENTS_LABEL: Record<FieldElements, string> = {
  wood: 'Wood elements',
  official: 'Official elements',
}

export const AVAILABILITY_LABEL: Record<FieldAvailability, string> = {
  year_round: 'Year round',
  in_season: 'In season',
  unknown: 'Not sure',
}

/** A short one-line summary of the field spec for cards and popups. */
export function fieldSpecSummary(
  f: Pick<PublicField, 'coverage' | 'elements' | 'hasFms'>,
  opts?: { fms?: boolean },
): string {
  const parts = [COVERAGE_LABEL[f.coverage], ELEMENTS_LABEL[f.elements].toLowerCase()]
  if (f.hasFms && opts?.fms !== false) parts.push('FMS')
  return parts.join(' · ')
}
