/**
 * The "you are here" dot for the visitor's own location, shared by the events
 * and fields maps (both had an identical copy).
 *
 * It is deliberately NOT a pin colour. The dot used to be filled with
 * --color-reg-open, the same purple an open-registration event pin wears, so a
 * visitor's location read as an event on the map. It fills with
 * --color-foreground instead: near-white in dark mode, near-black in light,
 * so it reads as "me" and never as a pin. The ring is --color-background, the
 * opposite of the fill, so the dot stays visible on both a light street map and
 * a dark one. A plain drop shadow gives legibility; the old coloured glow is
 * gone because it made the dot look like an active pin.
 *
 * A divIcon is HTML built in JavaScript and dropped into the document, so it
 * cannot carry a Tailwind class, but it DOES inherit the custom properties from
 * <html>. That means the dot follows a theme change on its own.
 */
export function userMarkerHtml(): string {
  return `<div style="width:14px;height:14px;background:var(--color-foreground);border:2px solid var(--color-background);border-radius:50%;box-shadow:0 1px 4px var(--color-pin-shadow)"></div>`
}
