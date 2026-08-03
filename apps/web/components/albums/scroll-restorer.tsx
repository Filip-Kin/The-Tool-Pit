'use client'

import { useEffect } from 'react'

/**
 * Remembers the scroll position of a browsable list per URL and restores it
 * when you come back (e.g. browser Back after opening an event), so you don't
 * lose your place. Keyed by pathname+search in sessionStorage.
 */
export function ScrollRestorer() {
  useEffect(() => {
    const key = `photopit:scroll:${location.pathname}${location.search}`

    const saved = sessionStorage.getItem(key)
    if (saved) {
      const y = parseInt(saved, 10)
      // Restore after paint so the (fixed-height) cards are laid out.
      requestAnimationFrame(() => window.scrollTo(0, y))
    }

    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        sessionStorage.setItem(key, String(window.scrollY))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
