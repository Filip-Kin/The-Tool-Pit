import type { MarkerStyle } from '@/lib/fields/field-display'

/**
 * Builds the inner HTML for a Leaflet divIcon from a MarkerStyle. Pure string
 * builder - no Leaflet dependency - so it's safe to import anywhere. The FMS
 * ring is a white outer box-shadow; elements-only fields render as a rotated
 * square (diamond).
 */
export function markerHtml(style: MarkerStyle, opts?: { selected?: boolean }): string {
  const { color, size, shape, ring } = style
  const selected = opts?.selected ?? false
  const border = shape === 'diamond' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.4)'
  const shadows = [
    ring ? '0 0 0 2px #ffffff' : null,
    selected ? '0 0 0 4px rgba(99,102,241,0.9)' : null,
    '0 1px 4px rgba(0,0,0,0.6)',
  ]
    .filter(Boolean)
    .join(', ')
  const radius = shape === 'circle' ? '50%' : '3px'
  const transform = shape === 'diamond' ? 'rotate(45deg)' : 'none'
  return `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid ${border};border-radius:${radius};box-shadow:${shadows};transform:${transform};transition:box-shadow .12s"></div>`
}
