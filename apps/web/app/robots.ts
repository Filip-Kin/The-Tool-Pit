import type { MetadataRoute } from 'next'
import { siteUrl } from '@the-tool-pit/types'

/**
 * robots.txt for frc.tools.
 *
 * Everything public is crawlable. The trees that are not: /admin (the
 * moderation panel), /me (a signed-in person's own screens), /api (data
 * endpoints, not pages) and the two search result pages, which are the same
 * listings under every query string and not worth an index entry each. The sitemap and host are stated absolutely off the
 * canonical origin so they are right on prod and on any preview host.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/me', '/api', '/search', '/photos/search'],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}
