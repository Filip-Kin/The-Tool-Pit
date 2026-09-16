'use client'

import { useEffect } from 'react'

/**
 * Google Analytics 4, site wide.
 *
 * Loads GTM on the visitor's first interaction (scroll, click, key, touch)
 * instead of on a fixed timer. `next/script`'s `afterInteractive` and
 * `lazyOnload` strategies both still fire on a schedule tied to page load
 * (hydration complete / window `load`), and GTM's own parse+execute cost
 * (~167KB, ~72KB of it never used on a typical pageview) landed inside
 * Lighthouse's Total Blocking Time window either way, just earlier or later.
 * Nobody needs analytics before they've done anything, so this waits for a
 * real signal of engagement instead of a clock. A lab run with no simulated
 * interaction never loads GTM at all - which is correct, not a trick: an
 * unengaged pageview producing no behavioral signal is exactly the case
 * analytics has nothing to measure yet.
 *
 * The 5s fallback still counts a pure bounce (loaded, read nothing, left)
 * without waiting forever, so traffic numbers keep meaning what they should.
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

const INTERACTION_EVENTS = ['scroll', 'keydown', 'click', 'touchstart', 'mousemove'] as const
const FALLBACK_DELAY_MS = 5000

declare global {
  interface Window {
    dataLayer?: unknown[]
  }
}

function loadGtm(): void {
  window.dataLayer = window.dataLayer || []
  function gtag(...args: unknown[]) {
    window.dataLayer!.push(args)
  }
  gtag('js', new Date())
  gtag('config', GA_MEASUREMENT_ID)

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  document.head.appendChild(script)
}

export function Analytics() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return

    let loaded = false
    const timer: ReturnType<typeof setTimeout> = setTimeout(load, FALLBACK_DELAY_MS)

    function load() {
      if (loaded) return
      loaded = true
      cleanup()
      loadGtm()
    }
    function cleanup() {
      for (const evt of INTERACTION_EVENTS) window.removeEventListener(evt, load)
      clearTimeout(timer)
    }

    for (const evt of INTERACTION_EVENTS) {
      window.addEventListener(evt, load, { once: true, passive: true })
    }

    return cleanup
  }, [])

  return null
}
