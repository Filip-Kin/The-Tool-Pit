'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, Marker as LeafletMarker, DivIcon } from 'leaflet'
import type { PublicField } from '@/lib/fields/field-display'
import { fieldMarkerStyle, fieldSpecSummary } from '@/lib/fields/field-display'
import { markerHtml } from './marker-html'

interface FieldMapProps {
  fields: PublicField[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Visitor's location, once granted, for a "you are here" marker + zoom-in. */
  userLoc?: { lat: number; lng: number } | null
  height?: number
}

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIB = '&copy; OpenStreetMap contributors &copy; CARTO'
const DEFAULT_CENTER: [number, number] = [39.5, -98.35]
// Zoom level to drop the visitor into once we know where they are: regional,
// enough to see their city and the fields around it.
const USER_ZOOM = 9

// A "you are here" pin: brand-purple device dot with a soft halo, distinct from
// the red/blue field pins so it never reads as a field.
function userMarkerHtml(): string {
  return `<div style="width:14px;height:14px;background:#7c3aed;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(124,58,237,0.25),0 1px 4px rgba(0,0,0,0.6)"></div>`
}

function tooltipHtml(f: PublicField): string {
  const team =
    f.teamNumber && f.teamName ? `${f.teamNumber} · ${f.teamName}` : f.teamNumber ? `Team ${f.teamNumber}` : f.teamName ?? ''
  const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div style="font-family:Inter,sans-serif;min-width:120px">
    <div style="font-weight:600;color:#0a0a0b">${esc(f.name)}</div>
    ${team ? `<div style="font-size:12px;color:#555;margin-top:1px">${esc(team)}</div>` : ''}
    <div style="font-size:12px;color:#777;margin-top:2px">${esc(fieldSpecSummary(f, { fms: false }))}</div>
  </div>`
}

/**
 * The explore map: every published field as a colour-coded pin. Hue = element
 * type (blue official / red wood), depth = coverage. Hovering shows a tooltip;
 * clicking opens the detail dialog. Leaflet is dynamic-imported so it never
 * runs during SSR.
 */
export function FieldMap({ fields, selectedId, onSelect, userLoc, height = 560 }: FieldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map())
  const iconsRef = useRef<Map<string, { base: DivIcon; selected: DivIcon }>>(new Map())
  const userMarkerRef = useRef<LeafletMarker | null>(null)
  const framedForUserRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Build the map and plot markers whenever the field set changes.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current) return

      if (!mapRef.current) {
        const map = L.map(containerRef.current, { center: DEFAULT_CENTER, zoom: 4, zoomControl: true })
        L.tileLayer(DARK_TILES, { subdomains: 'abcd', maxZoom: 20, attribution: TILE_ATTRIB }).addTo(map)
        mapRef.current = map
      }
      const map = mapRef.current

      // Clear existing markers before re-plotting.
      markersRef.current.forEach((m) => m.remove())
      markersRef.current.clear()
      iconsRef.current.clear()

      const latlngs: [number, number][] = []
      for (const f of fields) {
        if (f.latitude == null || f.longitude == null) continue
        const style = fieldMarkerStyle(f.coverage, f.elements)
        const base = L.divIcon({
          html: markerHtml(style),
          className: '',
          iconSize: [style.size, style.size],
          iconAnchor: [style.size / 2, style.size / 2],
        })
        const selected = L.divIcon({
          html: markerHtml(style, { selected: true }),
          className: '',
          iconSize: [style.size, style.size],
          iconAnchor: [style.size / 2, style.size / 2],
        })
        const marker = L.marker([f.latitude, f.longitude], { icon: base, riseOnHover: true })
          .addTo(map)
          .bindTooltip(tooltipHtml(f), { direction: 'top', offset: [0, -style.size / 2], opacity: 1 })
        marker.on('click', () => onSelectRef.current(f.id))
        markersRef.current.set(f.id, marker)
        iconsRef.current.set(f.id, { base, selected })
        latlngs.push([f.latitude, f.longitude])
      }

      // Drop (or move) the "you are here" marker once we know the visitor's spot.
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      if (userLoc) {
        const icon = L.divIcon({ html: userMarkerHtml(), className: '', iconSize: [14, 14], iconAnchor: [7, 7] })
        userMarkerRef.current = L.marker([userLoc.lat, userLoc.lng], { icon, interactive: true, zIndexOffset: 1000 })
          .addTo(map)
          .bindTooltip('You are here', { direction: 'top', offset: [0, -8], opacity: 1 })
      }

      // Framing: when we know where the visitor is, zoom into their area once
      // (the first time we get a fix); otherwise leave the view where they or a
      // card click put it. With no location, frame all fields as an overview.
      if (userLoc) {
        if (!framedForUserRef.current) {
          map.setView([userLoc.lat, userLoc.lng], USER_ZOOM)
          framedForUserRef.current = true
        }
      } else if (latlngs.length === 1) {
        map.setView(latlngs[0], 13)
      } else if (latlngs.length > 1) {
        map.fitBounds(L.latLngBounds(latlngs).pad(0.15))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fields, userLoc])

  // Tear the map down on unmount.
  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      markersRef.current.clear()
      iconsRef.current.clear()
      userMarkerRef.current = null
    }
  }, [])

  // Highlight + focus the selected field.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((marker, id) => {
      const icons = iconsRef.current.get(id)
      if (!icons) return
      marker.setIcon(id === selectedId ? icons.selected : icons.base)
    })
    if (selectedId) {
      const marker = markersRef.current.get(selectedId)
      // Bring the picked field into view; if we're zoomed way out (global
      // dataset), zoom in enough that it's actually usable.
      if (marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 12), { animate: true })
    }
  }, [selectedId])

  return <div ref={containerRef} style={{ height }} className="isolate overflow-hidden rounded-lg border border-border" />
}
