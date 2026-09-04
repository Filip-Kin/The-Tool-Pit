'use client'

import { useCallback, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'error-callback': () => void
          'expired-callback': () => void
          theme?: 'light' | 'dark' | 'auto'
        },
      ) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
const SCRIPT_ID = 'cf-turnstile-script'

/**
 * The Cloudflare check on the public submit forms, in one place.
 *
 * WHY IT IS A HOOK AND NOT SIX COPIES. Every submit form grew the same forty
 * lines: a ref, a widget id, an effect that injects the script and renders the
 * widget, and a reset. Six copies of a lifecycle is six chances to get the
 * lifecycle wrong, and all six had the same bug.
 *
 * THE BUG. A successful submit replaces the whole form with a confirmation, so
 * the container holding the widget unmounts. Pressing "Submit another" brought
 * the form back with a NEW container, but the effect that renders the widget
 * was keyed on values that had not changed, so it never ran again. No widget
 * meant no token, and no token meant a submit button that could never be
 * enabled: the second event, field, grant or repository could not be submitted
 * at all without a full page reload. Nothing said why, because from the page's
 * point of view nothing had gone wrong.
 *
 * THE FIX IS THE SHAPE, not a counter to bump. Rendering hangs off a CALLBACK
 * REF, so it is the container arriving that triggers it, every time one
 * arrives. React hands the callback the node on mount and null on unmount,
 * which is exactly the question being asked, and a remount is no longer a
 * special case anybody has to remember.
 *
 * `enabled` is how admin mode turns the check off: an admin session has
 * already proved who this is. With no site key configured, as in local
 * development, `required` is false and the forms carry on without a widget.
 */
export interface Turnstile {
  /** True when a token is needed before the form may be submitted. */
  required: boolean
  /** The solved token, or null. */
  token: string | null
  /** Attach to the element the widget should be drawn into. */
  containerRef: (node: HTMLDivElement | null) => void
  /** Clear a solved token and ask for a fresh one, e.g. after a failed post. */
  reset: () => void
}

export function useTurnstile(enabled = true): Turnstile {
  const required = Boolean(SITE_KEY) && enabled
  const [token, setToken] = useState<string | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }

      if (!node) {
        // Unmounting. Take the widget with it, rather than leaving Cloudflare
        // holding an id for a node that is no longer on the page.
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current)
          } catch {
            // An already-removed widget is not a problem worth a crash.
          }
        }
        widgetIdRef.current = null
        setToken(null)
        return
      }

      if (!required) return

      const draw = () => {
        if (!window.turnstile) return
        widgetIdRef.current = window.turnstile.render(node, {
          sitekey: SITE_KEY,
          callback: (t) => setToken(t),
          'error-callback': () => setToken(null),
          'expired-callback': () => setToken(null),
          theme: 'auto',
        })
      }

      if (window.turnstile) {
        draw()
        return
      }

      const existing = document.getElementById(SCRIPT_ID)
      if (!existing) {
        const script = document.createElement('script')
        script.id = SCRIPT_ID
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        script.async = true
        script.defer = true
        script.onload = draw
        document.head.appendChild(script)
        return
      }

      // The script is on its way in from an earlier mount. Wait for it rather
      // than adding a second copy.
      pollRef.current = setInterval(() => {
        if (!window.turnstile) return
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        draw()
      }, 100)
    },
    [required],
  )

  const reset = useCallback(() => {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current)
      setToken(null)
    }
  }, [])

  return { required, token, containerRef, reset }
}
