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
  /** 'circle' for full/half fields, 'diamond' for elements-only. */
  shape: 'circle' | 'diamond'
  /** White ring around the marker signals an FMS is available. */
  ring: boolean
}

const WOOD_FULL = '#f59e0b' // deep amber
const WOOD_HALF = '#fcd9a0' // pale amber
const OFFICIAL_FULL = '#10b981' // deep green
const OFFICIAL_HALF = '#a7e8cf' // pale green
export function fieldMarkerStyle(
  coverage: FieldCoverage,
  elements: FieldElements,
  hasFms: boolean,
): MarkerStyle {
  const full = coverage === 'full'
  const color =
    elements === 'official' ? (full ? OFFICIAL_FULL : OFFICIAL_HALF) : full ? WOOD_FULL : WOOD_HALF
  return { color, size: full ? 20 : 16, shape: 'circle', ring: hasFms }
}

/** Legend rows, in display order. */
export const MARKER_LEGEND: { label: string; style: MarkerStyle }[] = [
  { label: 'Full field, official elements', style: fieldMarkerStyle('full', 'official', false) },
  { label: 'Half field, official elements', style: fieldMarkerStyle('half', 'official', false) },
  { label: 'Full field, wood elements', style: fieldMarkerStyle('full', 'wood', false) },
  { label: 'Half field, wood elements', style: fieldMarkerStyle('half', 'wood', false) },
]

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
export function fieldSpecSummary(f: Pick<PublicField, 'coverage' | 'elements' | 'hasFms'>): string {
  const parts = [COVERAGE_LABEL[f.coverage], ELEMENTS_LABEL[f.elements].toLowerCase()]
  if (f.hasFms) parts.push('FMS')
  return parts.join(' · ')
}
