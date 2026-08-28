import type { Map as LeafletMap } from 'leaflet'

// Dark raster basemap for the fields maps. We moved off CARTO's keyless
// `rastertiles/dark_all`: CARTO now enforces API keys on basemaps.cartocdn.com
// and returns 401 "API key required" error tiles to browsers (pointing at
// carto.com/basemaps/apikey), so the map filled with error tiles. Esri's World
// Dark Gray Canvas needs no key and matches the dark theme. It ships as a
// label-free base plus a separate reference (labels) overlay, so we stack both
// to reproduce CARTO dark_all's all-in-one labelled look.
const ESRI_BASE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIB = '&copy; OpenStreetMap contributors, &copy; Esri'

/**
 * Add the dark basemap (base + label overlay) to a Leaflet map. Leaflet is
 * dynamic-imported here too so this stays SSR-safe and callers don't have to
 * thread the `L` instance through; the module is already cached by the time
 * this runs. Esri's tiles are native to zoom 16; Leaflet upscales beyond that
 * (maxZoom 20) so the map stays usable at street level.
 */
export async function addDarkBasemap(map: LeafletMap): Promise<void> {
  const L = (await import('leaflet')).default
  L.tileLayer(ESRI_BASE, { maxNativeZoom: 16, maxZoom: 20, attribution: TILE_ATTRIB }).addTo(map)
  L.tileLayer(ESRI_LABELS, { maxNativeZoom: 16, maxZoom: 20 }).addTo(map)
}
