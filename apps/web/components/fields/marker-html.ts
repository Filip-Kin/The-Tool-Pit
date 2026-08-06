import type { MarkerStyle } from '@/lib/fields/field-display'

/**
 * Builds the inner HTML for a Leaflet divIcon from a MarkerStyle. Pure string
 * builder - no Leaflet dependency - so it's safe to import anywhere. Pins are
 * circles with a white outline; a selected pin gets an indigo halo.
 */
export function markerHtml(style: MarkerStyle, opts?: { selected?: boolean }): string {
  const { color, size } = style
  const selected = opts?.selected ?? false
  const shadows = [
    selected ? '0 0 0 4px rgba(99,102,241,0.9)' : null,
    '0 1px 4px rgba(0,0,0,0.6)',
  ]
    .filter(Boolean)
    .join(', ')
  return `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;box-shadow:${shadows};transition:box-shadow .12s"></div>`
}
