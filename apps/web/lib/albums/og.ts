/**
 * Minimal Open Graph image scrape for the admin "refetch cover" action. Regex
 * over the head is enough (no HTML parser dependency in the web app) and it
 * never throws - a null result just means "couldn't find one".
 */
export async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // Some photo hosts serve a bare page to unknown agents; look like a browser.
        'user-agent':
          'Mozilla/5.0 (compatible; ThePhotoPit/1.0; +https://photos.ttp.filipkin.com)',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    const patterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m?.[1]) return m[1].replace(/&amp;/g, '&')
    }
    return null
  } catch {
    return null
  }
}
