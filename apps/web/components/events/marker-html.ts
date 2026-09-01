import type { MarkerStyle } from '@/lib/events/event-display'

/**
 * Builds the inner HTML for a Leaflet divIcon from a MarkerStyle. Pure string
 * builder - no Leaflet dependency - so it's safe to import anywhere. Pins are
 * circles with a ring; a selected pin gets an accent halo.
 *
 * Every colour is a var(). A divIcon is HTML built in JavaScript and dropped
 * into the document, so it cannot carry a Tailwind class, but it DOES inherit
 * the custom properties from <html>. That means the pins follow a theme change
 * on their own, with nothing here needing to know a theme exists.
 */
export function markerHtml(style: MarkerStyle, opts?: { selected?: boolean }): string {
  const { color, size } = style
  const selected = opts?.selected ?? false
  const shadows = [
    // The halo is the pin's own colour, so a selected grey pin does not
    // suddenly wear the brand accent.
    selected ? `0 0 0 4px color-mix(in srgb, ${color} 55%, transparent)` : null,
    `0 1px 4px var(--color-pin-shadow)`,
  ]
    .filter(Boolean)
    .join(', ')
  return `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid var(--color-pin-ring);border-radius:50%;box-shadow:${shadows};transition:box-shadow .12s"></div>`
}
