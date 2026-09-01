'use client'

import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import type { GeocodeResult, AddressParts } from '@/app/api/fields/geocode/route'
import { wrapLongitude, longitudeNearestTo } from '@/lib/geo/longitude'
import { attachBasemap } from '@/lib/map/basemap'

interface Coords {
  lat: number
  lng: number
}

interface PinMapProps {
  value: Coords | null
  onChange: (coords: Coords) => void
  /** Called with the address parts resolved for the pin (search pick or reverse-geocode on drag/click). */
  onResolveAddress?: (parts: AddressParts) => void
  height?: number
}

const DEFAULT_CENTER: [number, number] = [39.5, -98.35] // continental US
// Tokens, not hexes: this teardrop is dropped into the document as a string, so
// it cannot carry a Tailwind class, but it inherits the custom properties from
// <html> and follows the theme on its own.
const PIN_HTML =
  '<div style="width:22px;height:22px;background:var(--color-primary);border:3px solid var(--color-pin-ring);border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px var(--color-pin-shadow)"></div>'

/**
 * A draggable-pin map for setting a field's coordinates, with an address search
 * box that recentres the map. Leaflet is dynamic-imported so it never runs
 * during SSR. Reused by the public submit form and the admin editor.
 */
export function PinMap({ value, onChange, onResolveAddress, height = 320 }: PinMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  // Detaches the basemap's theme watcher, in the same teardown as the map.
  const detachBasemapRef = useRef<(() => void) | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onResolveAddressRef = useRef(onResolveAddress)
  onResolveAddressRef.current = onResolveAddress

  // Reverse-geocode a dropped/dragged pin and push the address parts up.
  async function reverseResolve(lat: number, lng: number) {
    if (!onResolveAddressRef.current) return
    try {
      const res = await fetch(`/api/fields/geocode?lat=${lat}&lon=${lng}`)
      if (!res.ok) return
      const parts = (await res.json()) as AddressParts
      onResolveAddressRef.current(parts)
    } catch {
      // ignore - auto-fill is best-effort
    }
  }

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build the map once.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current || mapRef.current) return

      const start: [number, number] = value ? [value.lat, value.lng] : DEFAULT_CENTER
      // The basemap tiles repeat forever, so panning east or west lands the
      // visitor on another copy of the world, where the pin, which is drawn
      // only at its real longitude, is nowhere to be seen. worldCopyJump holds
      // the view on the real copy as they drag, so the pin stays.
      const map = L.map(containerRef.current, {
        center: start,
        zoom: value ? 15 : 4,
        zoomControl: true,
        worldCopyJump: true,
      })
      detachBasemapRef.current = await attachBasemap(map)

      const icon = L.divIcon({ html: PIN_HTML, className: '', iconSize: [22, 22], iconAnchor: [11, 22] })

      /**
       * Put the pin where it was clicked and report where that really is.
       *
       * The marker keeps the longitude Leaflet gave us, so it lands under the
       * cursor even in the sliver of screen past the dateline. The value that
       * leaves this component is folded back onto the real world, because the
       * submit and edit handlers drop a longitude outside [-180, 180] and would
       * file the field with no coordinates at all.
       */
      function place(lat: number, lng: number): Coords {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng])
        } else {
          const m = L.marker([lat, lng], { icon, draggable: true }).addTo(map)
          m.on('dragend', () => {
            const p = m.getLatLng()
            const real = { lat: p.lat, lng: wrapLongitude(p.lng) }
            onChangeRef.current(real)
            void reverseResolve(real.lat, real.lng)
          })
          markerRef.current = m
        }
        const real = { lat, lng: wrapLongitude(lng) }
        onChangeRef.current(real)
        return real
      }

      // Initial pin (from an existing value) does not re-fill the address fields.
      if (value) place(value.lat, value.lng)
      map.on('click', (e) => {
        const real = place(e.latlng.lat, e.latlng.lng)
        void reverseResolve(real.lat, real.lng)
      })

      // A pin dropped past the dateline is drawn on the copy of the world it
      // was clicked on. Once a pan settles, bring it to the copy now on screen
      // so it can never end up a whole world off the side.
      map.on('moveend', () => {
        const m = markerRef.current
        if (!m) return
        const p = m.getLatLng()
        const onScreen = longitudeNearestTo(p.lng, map.getCenter().lng)
        if (onScreen !== p.lng) m.setLatLng([p.lat, onScreen])
      })
      mapRef.current = map
    })()

    return () => {
      cancelled = true
      detachBasemapRef.current?.()
      detachBasemapRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Intentionally build once; external value changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setResults([])
      setShowResults(false)
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`/api/fields/geocode?q=${encodeURIComponent(q.trim())}`)
      if (!res.ok) return
      const data = (await res.json()) as GeocodeResult[]
      setResults(data)
      setShowResults(data.length > 0)
    } catch {
      // ignore
    } finally {
      setSearching(false)
    }
  }, [])

  function onQueryChange(v: string) {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(v), 400)
  }

  async function pick(r: GeocodeResult) {
    setShowResults(false)
    setQuery(r.label.split(',').slice(0, 2).join(',').trim())
    const map = mapRef.current
    if (!map) return
    const L = (await import('leaflet')).default
    map.setView([r.lat, r.lon], 16)
    const icon = L.divIcon({ html: PIN_HTML, className: '', iconSize: [22, 22], iconAnchor: [11, 22] })
    if (markerRef.current) {
      markerRef.current.setLatLng([r.lat, r.lon])
    } else {
      const m = L.marker([r.lat, r.lon], { icon, draggable: true }).addTo(map)
      m.on('dragend', () => {
        const p = m.getLatLng()
        // Same fold as the click path: never report a longitude off the world.
        const real = { lat: p.lat, lng: wrapLongitude(p.lng) }
        onChangeRef.current(real)
        void reverseResolve(real.lat, real.lng)
      })
      markerRef.current = m
    }
    onChangeRef.current({ lat: r.lat, lng: r.lon })
    // The picked result already carries structured address parts.
    onResolveAddressRef.current?.({ address: r.address, city: r.city, region: r.region, country: r.country })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setShowResults(true) }}
          placeholder="Search an address to jump the map, then drag the pin to the exact spot"
          className="input"
          autoComplete="off"
        />
        {searching && <span className="absolute right-3 top-2 text-xs text-muted-2">…</span>}
        {showResults && results.length > 0 && (
          <ul className="absolute z-[1000] mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => void pick(r)}
                  className="block w-full truncate px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        ref={containerRef}
        style={{ height }}
        className="isolate overflow-hidden rounded-lg border border-border"
      />
      <p className="text-xs text-muted-2">
        {value
          ? `Pin set at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Click the map or drag the pin to adjust.`
          : 'Click the map to drop a pin, or search an address above.'}
      </p>
    </div>
  )
}
