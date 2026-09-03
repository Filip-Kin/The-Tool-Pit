import type { MetadataRoute } from 'next'
import { siteUrl } from '@the-tool-pit/types'

/**
 * robots.txt for frc.tools.
 *
 * Everything public is crawlable. The three trees that are not: /admin (the
 * moderation panel), /me (a signed-in person's own screens) and /api (data
 * endpoints, not pages). The sitemap and host are stated absolutely off the
 * canonical origin so they are right on prod and on any preview host.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/me', '/api'],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}
