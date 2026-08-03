/**
 * Flickr cover sync - runs on the NAS (residential IP), NOT the cloud box.
 *
 * The cloud worker is IP-blocked from Flickr, so it can never fetch Flickr album
 * covers. This script pulls the list of published Flickr albums missing a cover
 * from the web app, scrapes each album's cover from the NAS, and pushes the
 * results back. Intended to run from a daily NAS cron.
 *
 * Env:
 *   WEB_BASE     - e.g. https://photos.ttp.filipkin.com  (defaults to that)
 *   ADMIN_SECRET - matches the web app's ADMIN_SECRET
 *
 * Run: ADMIN_SECRET=... bun scripts/flickr-cover-sync.ts
 */
const WEB_BASE = process.env.WEB_BASE || 'https://photos.ttp.filipkin.com'
const ADMIN_SECRET = process.env.ADMIN_SECRET
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

if (!ADMIN_SECRET) {
  console.error('ADMIN_SECRET is required')
  process.exit(1)
}

/** Scrape a Flickr album cover: og:image, else the first full-size photo in the page. */
async function scrapeCover(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' })
    if (!res.ok) {
      console.warn(`  fetch ${url} -> HTTP ${res.status}`)
      return null
    }
    const html = await res.text()
    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    if (og?.[1]) return og[1].replace(/&amp;/g, '&')
    // Fallback: first Flickr-hosted photo in the album's embedded model.
    const first = html.match(/https?:\\?\/\\?\/live\.staticflickr\.com\\?\/[^"'\\]+_(?:b|c|z)\.jpg/i)
    if (first) return first[0].replace(/\\\//g, '/')
    return null
  } catch (err) {
    console.warn(`  error ${url}: ${String(err)}`)
    return null
  }
}

async function main() {
  const listRes = await fetch(`${WEB_BASE}/api/albums/flickr-covers`, {
    headers: { 'x-admin-secret': ADMIN_SECRET! },
  })
  if (!listRes.ok) {
    console.error(`list failed: HTTP ${listRes.status}`)
    process.exit(1)
  }
  const { albums } = (await listRes.json()) as { albums: { id: string; url: string }[] }
  console.log(`${albums.length} Flickr albums missing a cover`)

  const covers: { id: string; coverImageUrl: string }[] = []
  for (const a of albums) {
    const cover = await scrapeCover(a.url)
    if (cover) {
      covers.push({ id: a.id, coverImageUrl: cover })
      console.log(`  ✓ ${a.url}`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  if (covers.length === 0) {
    console.log('nothing to push')
    return
  }
  const postRes = await fetch(`${WEB_BASE}/api/albums/flickr-covers`, {
    method: 'POST',
    headers: { 'x-admin-secret': ADMIN_SECRET!, 'content-type': 'application/json' },
    body: JSON.stringify({ covers }),
  })
  const result = await postRes.json()
  console.log(`pushed ${covers.length}, server updated:`, result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
