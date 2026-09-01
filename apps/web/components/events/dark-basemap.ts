import type { Map as LeafletMap } from 'leaflet'

// Dark raster basemap for the events map. Same choice as the fields map: CARTO
// now enforces API keys on its keyless dark tiles and returns 401 error tiles,
// so we use Esri's World Dark Gray Canvas (no key, matches the dark theme). It
// ships as a label-free base plus a separate reference (labels) overlay, so we
// stack both to reproduce an all-in-one labelled dark look.
const ESRI_BASE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIB = '&copy; OpenStreetMap contributors, &copy; Esri'

/** Add the dark basemap (base + label overlay) to a Leaflet map. */
export async function addDarkBasemap(map: LeafletMap): Promise<void> {
  const L = (await import('leaflet')).default
  L.tileLayer(ESRI_BASE, { maxNativeZoom: 16, maxZoom: 20, attribution: TILE_ATTRIB }).addTo(map)
  L.tileLayer(ESRI_LABELS, { maxNativeZoom: 16, maxZoom: 20 }).addTo(map)
}
