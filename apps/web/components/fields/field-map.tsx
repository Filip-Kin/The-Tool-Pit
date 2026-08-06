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
  height?: number
}

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIB = '&copy; OpenStreetMap contributors &copy; CARTO'
const DEFAULT_CENTER: [number, number] = [39.5, -98.35]

function popupHtml(f: PublicField): string {
  const title = f.teamNumber ? `${f.teamNumber} · ${f.name}` : f.name
  const loc = [f.city, f.region].filter(Boolean).join(', ')
  const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div style="font-family:Inter,sans-serif;min-width:150px">
    <div style="font-weight:600;color:#0a0a0b">${esc(title)}</div>
    <div style="font-size:12px;color:#555;margin-top:2px">${esc(fieldSpecSummary(f))}</div>
    ${loc ? `<div style="font-size:12px;color:#777;margin-top:2px">${esc(loc)}</div>` : ''}
  </div>`
}

/**
 * The explore map: every published field as a colour-coded pin. Hue = element
 * type, depth = coverage, white ring = FMS, grey diamond = elements-only.
 * Selection is two-way with the list beside it. Leaflet is dynamic-imported so
 * it never runs during SSR.
 */
export function FieldMap({ fields, selectedId, onSelect, height = 560 }: FieldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map())
  const iconsRef = useRef<Map<string, { base: DivIcon; selected: DivIcon }>>(new Map())
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
        const style = fieldMarkerStyle(f.coverage, f.elements, f.hasFms)
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
          .bindPopup(popupHtml(f))
        marker.on('click', () => onSelectRef.current(f.id))
        markersRef.current.set(f.id, marker)
        iconsRef.current.set(f.id, { base, selected })
        latlngs.push([f.latitude, f.longitude])
      }

      if (latlngs.length === 1) {
        map.setView(latlngs[0], 13)
      } else if (latlngs.length > 1) {
        map.fitBounds(L.latLngBounds(latlngs).pad(0.15))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fields])

  // Tear the map down on unmount.
  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      markersRef.current.clear()
      iconsRef.current.clear()
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
      if (marker) {
        map.panTo(marker.getLatLng())
        marker.openPopup()
      }
    }
  }, [selectedId])

  return <div ref={containerRef} style={{ height }} className="isolate overflow-hidden rounded-lg border border-border" />
}
