'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, MapPin, TriangleAlert } from 'lucide-react'
import type { AddressParts, GeocodeResult } from '@/app/api/fields/geocode/route'

/**
 * A verified-address autocomplete, in place of the drag-a-pin map.
 *
 * The map wasted the top third of every edit form and still let a bad address
 * through: nothing was geocoded until Accept, so an unresolvable venue geocoded
 * to nothing at publish time and the listing dropped silently back into pending
 * with no idea which field was wrong.
 *
 * This box fixes both. It suggests only REAL geocoded addresses as you type
 * (the same server-side Nominatim proxy the map used), and picking one fills the
 * address fields AND captures the coordinates then and there. A ✓ says the pin
 * is known and the listing will place correctly; typed text that has not been
 * confirmed against a suggestion is called out, in the form, before Accept, so
 * the silent failure cannot happen.
 *
 * It does NOT block. An unverified address is flagged, not refused: some venues
 * simply are not in the map data, and the reviewer stays in control.
 */

interface AddressFieldProps {
  /** Seed the search box, e.g. the address already on the listing. */
  defaultQuery?: string
  /** True while coordinates are captured for this listing. Drives the ✓. */
  verified: boolean
  /** A suggestion was chosen: its address parts and confirmed coordinates. */
  onPick: (parts: AddressParts, coords: { lat: number; lng: number }) => void
  /** The box was edited away from the last pick, so any captured pin is stale. */
  onClear?: () => void
  placeholder?: string
  className?: string
}

const MIN_QUERY = 3
const DEBOUNCE_MS = 400

export function AddressField({
  defaultQuery = '',
  verified,
  onPick,
  onClear,
  placeholder = 'Search the venue or address, then pick a match',
  className,
}: AddressFieldProps) {
  const [query, setQuery] = useState(defaultQuery)
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [searching, setSearching] = useState(false)
  // True once the reviewer has typed and not yet picked a suggestion, so an
  // unconfirmed address reads as unverified rather than as "nothing entered".
  const [touched, setTouched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowResults(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < MIN_QUERY) {
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
      // Best-effort: a failed lookup just shows no suggestions.
    } finally {
      setSearching(false)
    }
  }, [])

  function onQueryChange(v: string) {
    setQuery(v)
    setTouched(true)
    // Editing the box after a pick means the captured pin no longer matches what
    // is typed, so it is no longer trusted until a new suggestion is chosen.
    onClear?.()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(v), DEBOUNCE_MS)
  }

  function pick(r: GeocodeResult) {
    setShowResults(false)
    setTouched(false)
    setQuery(r.label.split(',').slice(0, 3).join(',').trim())
    onPick(
      { address: r.address, city: r.city, region: r.region, country: r.country },
      { lat: r.lat, lng: r.lon },
    )
  }

  return (
    <div ref={boxRef} className={className}>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setShowResults(true)
          }}
          placeholder={placeholder}
          className="input pr-9"
          autoComplete="off"
          aria-label="Search for the address"
        />
        {searching && <span className="absolute right-3 top-2 text-xs text-muted-2">…</span>}
        {showResults && results.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-2" aria-hidden />
                  <span className="min-w-0 break-words">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The verified state, inline and before Accept. Never blocks; it tells. */}
      {verified ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rookie">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Address verified — the pin is set and it will place correctly on the map.
        </p>
      ) : touched ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-official">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Not verified yet. Pick a suggestion so the pin is captured, or this listing
          cannot be placed on the map.
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-muted-2">
          Type an address or venue and pick a suggestion. The address fields below fill in
          from your choice.
        </p>
      )}
    </div>
  )
}
