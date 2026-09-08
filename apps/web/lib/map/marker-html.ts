/**
 * The inner HTML for a Leaflet divIcon pin. Pure string builder, no Leaflet
 * dependency, so it is safe to import anywhere. Shared by the events map and
 * the practice-field map: a pin is a circle with a ring, and a selected pin
 * gets a halo in ITS OWN colour (a fixed accent halo read as a fifth legend
 * colour on top of the four the legend explains).
 *
 * Every colour is a var(). A divIcon is HTML built in JavaScript and dropped
 * into the document, so it cannot carry a Tailwind class, but it DOES inherit
 * the custom properties from <html>. So the pins follow a theme change on
 * their own, with nothing here needing to know a theme exists.
 */
export interface PinStyle {
  /** A CSS colour. A var(), because each of these has a light value too. */
  color: string
  /** Diameter in px at scale 1. */
  size: number
}

export function markerHtml(style: PinStyle, opts?: { selected?: boolean; size?: number }): string {
  const { color } = style
  const size = opts?.size ?? style.size
  const selected = opts?.selected ?? false
  const ring = Math.max(1.5, Math.round(size / 9))
  const shadows = [
    selected ? `0 0 0 ${Math.max(3, Math.round(size / 5))}px color-mix(in srgb, ${color} 55%, transparent)` : null,
    `0 1px 4px var(--color-pin-shadow)`,
  ]
    .filter(Boolean)
    .join(', ')
  return `<div style="width:${size}px;height:${size}px;background:${color};border:${ring}px solid var(--color-pin-ring);border-radius:50%;box-shadow:${shadows};transition:box-shadow .12s"></div>`
}
