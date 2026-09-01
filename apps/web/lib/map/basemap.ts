import type { Map as LeafletMap, TileLayer } from 'leaflet'
import type { ResolvedTheme } from '@/lib/theme/theme'
import { getResolvedTheme, onResolvedThemeChange } from '@/lib/theme/theme-dom'

/**
 * The raster basemap under every map on the site, in whichever theme is on.
 *
 * One module for all three maps. The events map and the fields map each had
 * their own copy of this file, identical apart from the comment at the top, and
 * the pin map imported one of them. A dark map under a light page looks broken,
 * so the swap had to be written once rather than three times.
 *
 * Esri, not CARTO. CARTO now enforces API keys on basemaps.cartocdn.com and
 * returns 401 "API key required" error tiles to browsers, so the maps filled
 * with error tiles. Esri's Canvas services need no key and come in both greys.
 * Each ships as a label-free base plus a separate reference (labels) overlay,
 * so both are stacked to get an all-in-one labelled look.
 */

const TILES: Record<ResolvedTheme, { base: string; labels: string }> = {
  dark: {
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labels:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  },
  light: {
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labels:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  },
}

const TILE_ATTRIB = '&copy; OpenStreetMap contributors, &copy; Esri'

/** Esri's tiles are native to zoom 16; Leaflet upscales past that so the map stays usable at street level. */
const TILE_OPTIONS = { maxNativeZoom: 16, maxZoom: 20 }

/**
 * Add the basemap for the current theme, and keep it in step with the theme.
 *
 * Leaflet is dynamic-imported here so this stays SSR-safe and callers do not
 * have to thread the `L` instance through. Returns a detach function; call it
 * when the map goes away, or the observer outlives the map it was watching for.
 */
export async function attachBasemap(map: LeafletMap): Promise<() => void> {
  const L = (await import('leaflet')).default

  function add(theme: ResolvedTheme): TileLayer[] {
    const { base, labels } = TILES[theme]
    return [
      L.tileLayer(base, { ...TILE_OPTIONS, attribution: TILE_ATTRIB }).addTo(map),
      L.tileLayer(labels, TILE_OPTIONS).addTo(map),
    ]
  }

  let layers = add(getResolvedTheme())

  const unwatch = onResolvedThemeChange((theme) => {
    // Add the new tiles BEFORE dropping the old ones. The other order leaves
    // the map showing its own background colour for as long as the first tiles
    // take to arrive, which on a slow connection is most of a second of blank
    // grey where the map used to be.
    const next = add(theme)
    for (const layer of layers) layer.remove()
    layers = next
  })

  return () => {
    unwatch()
    for (const layer of layers) layer.remove()
    layers = []
  }
}
