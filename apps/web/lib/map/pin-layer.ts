/**
 * Pins on a Leaflet map, with the two things a plain marker per row gets wrong:
 *
 * 1. TWO PINS ON ONE SPOT. Two events at the same venue (Kettering runs its
 *    kickoff and its Week 0 on the same campus; a school hosts a field and an
 *    event) geocode to the same point, and the second pin sits exactly under
 *    the first: invisible, unclickable, and the map lies about how many things
 *    are there. Pins AT THE SAME VENUE (within SAME_SPOT_M of each other) are
 *    pushed apart into a small ring around their shared spot, a fixed number
 *    of pixels, from city zoom (SPREAD_MIN_ZOOM) inward; zoomed out they stay
 *    stacked, which is what that scale honestly shows. The grouping is
 *    GEOGRAPHIC on purpose: the first version grouped by pixel overlap, and at
 *    continent zoom every pin in the eastern US overlaps its neighbour, so the
 *    whole region chained into one group and drew as a single giant ring.
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

/**
 * Diameter multiplier for a zoom level. 0.55x at zoom 4 and below, 1.2x at
 * zoom 15 and above, eased so pins grow slowly through the regional zooms
 * (0.62x at 6, 0.75x at 9, 0.95x at 12) and reach full size near street level.
 */
export function pinScale(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - 4) / 11))
  return 0.55 + 0.65 * Math.pow(t, 1.3)
}

/** Two pins closer than this are "legitimately the same location": one campus, one gym. */
export const SAME_SPOT_M = 300

/**
 * Below this zoom nothing is spread, ever. Zoomed out, a stack of pins on one
 * campus is one dot and that is the truth of the map at that scale; pulling
 * them apart there just draws flowers. City zoom and in, they get their ring.
 */
export const SPREAD_MIN_ZOOM = 10

/** Metres between two points; good enough at venue scale. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Where to draw each pin. Pins at the same venue (SAME_SPOT_M, transitively,
 * which at 150 m can only ever chain across one campus) are laid out on a ring
 * of `overlapPx * 0.55` px around their centroid, but only while they would
 * actually overlap on screen; zoomed in far enough that two buildings 100 m
 * apart draw as two separate dots, they get their true positions. Everything
 * else is drawn where it is. Pure over container points plus coordinates; the
 * caller projects and unprojects.
 */
export function spreadPoints(
  points: Array<{ id: string; x: number; y: number; lat: number; lng: number }>,
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
        if (metresBetween(points[a], points[b]) <= SAME_SPOT_M) {
          groupOf[b] = groups.length
          stack.push(b)
        }
      }
    }
    groups.push(members)
  }
  for (const members of groups) {
    // Alone, or far enough apart on screen already: true positions.
    const overlapping =
      members.length > 1 &&
      members.some((a) =>
        members.some((b) => {
          if (a === b) return false
          const dx = points[a].x - points[b].x
          const dy = points[a].y - points[b].y
          return dx * dx + dy * dy < overlapPx * overlapPx
        }),
      )
    if (!overlapping) {
      for (const i of members) out.set(points[i].id, { x: points[i].x, y: points[i].y })
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
      return { id: p.id, x: pt.x, y: pt.y, lat: p.lat, lng: p.lng }
    })
    // Overlap threshold = the drawn diameter plus a little air. Zoomed out,
    // every pin stays exactly where it is.
    const maxSize = Math.max(...pins.map((p) => p.style.size), 1) * scale
    const placed =
      zoom >= SPREAD_MIN_ZOOM
        ? spreadPoints(points, maxSize + 4)
        : new Map(points.map((pt) => [pt.id, { x: pt.x, y: pt.y }]))
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
