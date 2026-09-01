import Script from 'next/script'

/**
 * Google Analytics 4, site wide.
 *
 * Uses next/script rather than @next/third-parties so this adds no dependency.
 * `afterInteractive` is the right strategy for a tag: it must run on every page
 * but never block first paint.
 *
 * The measurement ID is not a secret, it ships in the page source by design, so
 * it lives here rather than in an env var that would have to be set as a
 * build-time variable in Coolify to reach the browser at all.
 *
 * Development is excluded on purpose. Without this every local page load and
 * every `next dev` refresh lands in the same property as real traffic, and the
 * numbers stop meaning anything for a site whose whole point is finding out
 * which verticals people actually use.
 *
 * GA4 tracks client-side route changes by itself through enhanced measurement,
 * which matters here because the six verticals are paths in one Next app, so
 * moving between them is usually a soft navigation with no page load to hook.
 */
const GA_MEASUREMENT_ID = 'G-0LJW5G1EGE'

export function Analytics() {
  if (process.env.NODE_ENV !== 'production') return null

  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}');
        `}
      </Script>
    </>
  )
}
