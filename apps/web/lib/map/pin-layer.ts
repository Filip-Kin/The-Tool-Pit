/**
 * Pins on a Leaflet map, with the two things a plain marker per row gets wrong:
 *
 * 1. TWO PINS ON ONE SPOT. Two events at the same venue (Kettering runs its
 *    kickoff and its Week 0 on the same campus; a school hosts a field and an
 *    event) geocode to the same point, and the second pin sits exactly under
 *    the first: invisible, unclickable, and the map lies about how many things
 *    are there. Pins that would overlap AT THE CURRENT ZOOM are pushed apart
 *    into a small ring around their shared spot, a fixed number of pixels, so
 *    at any zoom each one is a separate target. Zoom in on two places that are
 *    genuinely a street apart and they fall back to their true positions on
 *    their own, because the test is pixel distance, not coordinates.
 *
 * 2. PIN SIZE FOLLOWS ZOOM. A 14 px dot is right at continent zoom, where
 *    hundreds of pins share the view, and mean at street zoom, where one pin
 *    sits alone in a gym car park. The diameter scales with the zoom level
 *    inside a fixed band, and the halo and ring scale with it.
 *
 * Leaflet is passed in rather than imported: the maps dynamic-import it inside
 * an effect so it never runs during SSR, and this module must not undo that.
 */
import type { DivIcon, LatLngExpression, Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import { markerHtml, type PinStyle } from './marker-html'

type Leaflet = typeof import('leaflet')

export interface PinSpec {
  id: string
  lat: number
  lng: number
  style: PinStyle
  tooltipHtml: string
}

export interface PinLayer {
  /** Highlight one pin (or none). */
  setSelected(id: string | null): void
  /** Where a pin is DRAWN right now (spread position), for panInside. */
  drawnLatLng(id: string): LatLngExpression | null
  /** Remove every pin and the zoom listener. */
  destroy(): void
}

/** Diameter multiplier for a zoom level: 0.8x at zoom 4 and below, 1.9x at zoom 15 and above. */
export function pinScale(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - 4) / 11))
  return 0.8 + 1.1 * t
}

/**
 * Where to draw each pin so none overlap. Pins are grouped greedily by pixel
 * distance (any two closer than `overlapPx` share a group, transitively), and a
 * group of two or more is laid out on a ring of `overlapPx * 0.55` px around
 * its centroid. Pure over container points; the caller projects and unprojects.
 */
export function spreadPoints(
  points: Array<{ id: string; x: number; y: number }>,
  overlapPx: number,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  const n = points.length
  const groupOf = new Array<number>(n).fill(-1)
  const groups: number[][] = []
  for (let i = 0; i < n; i++) {
    if (groupOf[i] !== -1) continue
    const stack = [i]
    const members: number[] = []
    groupOf[i] = groups.length
    while (stack.length) {
      const a = stack.pop() as number
      members.push(a)
      for (let b = 0; b < n; b++) {
        if (groupOf[b] !== -1) continue
        const dx = points[a].x - points[b].x
        const dy = points[a].y - points[b].y
        if (dx * dx + dy * dy < overlapPx * overlapPx) {
          groupOf[b] = groups.length
          stack.push(b)
        }
      }
    }
    groups.push(members)
  }
  for (const members of groups) {
    if (members.length === 1) {
      const p = points[members[0]]
      out.set(p.id, { x: p.x, y: p.y })
      continue
    }
    const cx = members.reduce((s, i) => s + points[i].x, 0) / members.length
    const cy = members.reduce((s, i) => s + points[i].y, 0) / members.length
    // Ring radius grows a little with group size so five pins do not touch.
    const r = overlapPx * (members.length <= 2 ? 0.55 : 0.55 + 0.12 * (members.length - 2))
    // Stable order (by id) so a pin does not jump to a different slot on every relayout.
    const ordered = [...members].sort((a, b) => points[a].id.localeCompare(points[b].id))
    ordered.forEach((i, k) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * k) / ordered.length
      out.set(points[i].id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
    })
  }
  return out
}

export function installPins(opts: {
  L: Leaflet
  map: LeafletMap
  pins: PinSpec[]
  onSelect: (id: string) => void
}): PinLayer {
  const { L, map, pins, onSelect } = opts
  const markers = new Map<string, LeafletMarker>()
  const icons = new Map<string, { base: DivIcon; selected: DivIcon }>()
  const byId = new Map(pins.map((p) => [p.id, p]))
  let selectedId: string | null = null

  const icon = (p: PinSpec, size: number, selected: boolean) =>
    L.divIcon({
      html: markerHtml(p.style, { selected, size }),
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })

  /** Rebuild every icon at the current zoom's scale and re-spread positions. */
  const relayout = () => {
    const zoom = map.getZoom()
    const scale = pinScale(zoom)
    const points = pins.map((p) => {
      const pt = map.latLngToContainerPoint([p.lat, p.lng])
      return { id: p.id, x: pt.x, y: pt.y }
    })
    // Overlap threshold = the drawn diameter plus a little air.
    const maxSize = Math.max(...pins.map((p) => p.style.size), 1) * scale
    const placed = spreadPoints(points, maxSize + 4)
    for (const p of pins) {
      const m = markers.get(p.id)
      if (!m) continue
      const size = Math.round(p.style.size * scale)
      const pair = { base: icon(p, size, false), selected: icon(p, size, true) }
      icons.set(p.id, pair)
      m.setIcon(p.id === selectedId ? pair.selected : pair.base)
      const tt = m.getTooltip()
      if (tt) tt.options.offset = L.point(0, -size / 2)
      const at = placed.get(p.id)
      if (at) m.setLatLng(map.containerPointToLatLng([at.x, at.y]))
    }
  }

  for (const p of pins) {
    const size = Math.round(p.style.size * pinScale(map.getZoom()))
    const pair = { base: icon(p, size, false), selected: icon(p, size, true) }
    icons.set(p.id, pair)
    const m = L.marker([p.lat, p.lng], { icon: pair.base, riseOnHover: true })
      .addTo(map)
      .bindTooltip(p.tooltipHtml, { direction: 'top', offset: [0, -size / 2], opacity: 1 })
    m.on('click', () => onSelect(p.id))
    markers.set(p.id, m)
  }
  relayout()
  map.on('zoomend', relayout)

  return {
    setSelected(id) {
      selectedId = id
      markers.forEach((m, mid) => {
        const pair = icons.get(mid)
        if (pair) m.setIcon(mid === id ? pair.selected : pair.base)
      })
      // The selected pin rises above its ring-mates.
      markers.forEach((m, mid) => m.setZIndexOffset(mid === id ? 500 : 0))
    },
    drawnLatLng(id) {
      const m = markers.get(id)
      return m ? m.getLatLng() : byId.has(id) ? [byId.get(id)!.lat, byId.get(id)!.lng] : null
    },
    destroy() {
      map.off('zoomend', relayout)
      markers.forEach((m) => m.remove())
      markers.clear()
      icons.clear()
    },
  }
}
