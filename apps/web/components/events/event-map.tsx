'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, Marker as LeafletMarker, DivIcon } from 'leaflet'
import type { PublicEvent } from '@/lib/events/event-display'
import {
  eventMarkerStyle,
  eventDateRange,
  eventLocation,
  fullnessLabel,
  timingPhrase,
} from '@/lib/events/event-display'
import { markerHtml } from './marker-html'
import { addDarkBasemap } from './dark-basemap'

interface EventMapProps {
  events: PublicEvent[]
  now: Date
  selectedId: string | null
  onSelect: (id: string) => void
  userLoc?: { lat: number; lng: number } | null
  height?: number
}

const DEFAULT_CENTER: [number, number] = [39.5, -98.35]
const USER_ZOOM = 8

function userMarkerHtml(): string {
  return `<div style="width:14px;height:14px;background:#7c3aed;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(124,58,237,0.25),0 1px 4px rgba(0,0,0,0.6)"></div>`
}

function tooltipHtml(ev: PublicEvent, now: Date): string {
  const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const date = eventDateRange(ev)
  const full = fullnessLabel(ev)
  // The pin cannot carry this. Grey means past OR cancelled OR nobody has told
  // us the registration state, so where the event sits in its life has to be
  // written down. Cancelled reads red, because it is the one that wastes a trip.
  const phrase = timingPhrase(ev, now)
  const phraseColor = ev.eventStatus === 'cancelled' ? '#ef4444' : '#0a0a0b'
  return `<div style="font-family:Inter,sans-serif;min-width:130px">
    <div style="font-weight:600;color:#0a0a0b">${esc(ev.name)}</div>
    <div style="font-size:12px;font-weight:600;color:${phraseColor};margin-top:1px">${esc(phrase)}</div>
    ${date ? `<div style="font-size:12px;color:#555;margin-top:1px">${esc(date)}</div>` : ''}
    <div style="font-size:12px;color:#777;margin-top:2px">${esc(eventLocation(ev))}</div>
    ${full ? `<div style="font-size:12px;color:#7c3aed;margin-top:2px">${esc(full)}</div>` : ''}
  </div>`
}

/**
 * The explore map: every published event as a pin coloured by REGISTRATION
 * (accent for open, amber for opens later, red for closed or waitlist, grey
 * once it has run or been called off). Hovering shows a tooltip; clicking
 * opens the detail dialog. Leaflet is dynamic-imported so it never runs during
 * SSR. Mirrors the fields map.
 */
export function EventMap({ events, now, selectedId, onSelect, userLoc, height = 560 }: EventMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map())
  const iconsRef = useRef<Map<string, { base: DivIcon; selected: DivIcon }>>(new Map())
  const userMarkerRef = useRef<LeafletMarker | null>(null)
  const framedForUserRef = useRef(false)
  const selectedFromMapRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current) return

      if (!mapRef.current) {
        // The basemap tiles repeat forever, so panning east or west lands the
        // visitor on another copy of the world, where the pins, which are drawn
        // only at their real longitude, are nowhere to be seen. worldCopyJump
        // holds the view on the real copy as they drag, so the pins stay.
        const map = L.map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 4,
          zoomControl: true,
          worldCopyJump: true,
        })
        await addDarkBasemap(map)
        mapRef.current = map
      }
      const map = mapRef.current

      markersRef.current.forEach((m) => m.remove())
      markersRef.current.clear()
      iconsRef.current.clear()

      const latlngs: [number, number][] = []
      for (const ev of events) {
        if (ev.latitude == null || ev.longitude == null) continue
        const style = eventMarkerStyle(ev, now)
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
        const marker = L.marker([ev.latitude, ev.longitude], { icon: base, riseOnHover: true })
          .addTo(map)
          .bindTooltip(tooltipHtml(ev, now), { direction: 'top', offset: [0, -style.size / 2], opacity: 1 })
        marker.on('click', () => {
          selectedFromMapRef.current = true
          onSelectRef.current(ev.id)
        })
        markersRef.current.set(ev.id, marker)
        iconsRef.current.set(ev.id, { base, selected })
        latlngs.push([ev.latitude, ev.longitude])
      }

      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      if (userLoc) {
        const icon = L.divIcon({ html: userMarkerHtml(), className: '', iconSize: [14, 14], iconAnchor: [7, 7] })
        userMarkerRef.current = L.marker([userLoc.lat, userLoc.lng], { icon, interactive: true, zIndexOffset: 1000 })
          .addTo(map)
          .bindTooltip('You are here', { direction: 'top', offset: [0, -8], opacity: 1 })
      }

      if (userLoc) {
        if (!framedForUserRef.current) {
          map.setView([userLoc.lat, userLoc.lng], USER_ZOOM)
          framedForUserRef.current = true
        }
      } else if (latlngs.length === 1) {
        map.setView(latlngs[0], 11)
      } else if (latlngs.length > 1) {
        map.fitBounds(L.latLngBounds(latlngs).pad(0.15))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [events, now, userLoc])

  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      markersRef.current.clear()
      iconsRef.current.clear()
      userMarkerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((marker, id) => {
      const icons = iconsRef.current.get(id)
      if (!icons) return
      marker.setIcon(id === selectedId ? icons.selected : icons.base)
    })
    if (selectedId) {
      if (selectedFromMapRef.current) {
        selectedFromMapRef.current = false
      } else {
        const marker = markersRef.current.get(selectedId)
        // Selected from the list: highlight it, and pan only far enough to get
        // it on screen. Zoom stays where the visitor put it, so picking through
        // the list never yanks them out of the area they were looking at.
        if (marker) map.panInside(marker.getLatLng(), { padding: [48, 48], animate: true })
      }
    }
  }, [selectedId])

  return <div ref={containerRef} style={{ height }} className="isolate overflow-hidden rounded-lg border border-border" />
}
