'use client'

import {
  DARK_QUERY,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from './theme'

/**
 * The browser half of the theme: reading and writing the two places the state
 * actually lives.
 *
 * ONE SOURCE OF TRUTH FOR WHAT IS PAINTED: the `data-theme` attribute on
 * <html>. The head script writes it before first paint, the OS media listener
 * rewrites it when the system flips, and the toggle rewrites it when the
 * visitor picks. Anything that needs to know the current theme reads the
 * attribute rather than keeping its own copy, which is how the map and the
 * toggle stay in step with a change neither of them made.
 */

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

/** The stored preference, or 'system' when there is none or storage is closed. */
export function getStoredPreference(): ThemePreference {
  return readStoredPreference(storage)
}

/** What the OS is asking for right now. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia(DARK_QUERY).matches
}

/** The theme currently on screen, read off <html>. */
export function getResolvedTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark'
  const attr = document.documentElement.getAttribute(THEME_ATTRIBUTE)
  return attr === 'light' ? 'light' : 'dark'
}

/**
 * Store a preference and paint it.
 *
 * The write is best-effort. If storage is closed the choice still applies to
 * this page, it just will not be remembered, which is a better outcome than a
 * toggle that does nothing.
 */
export function applyPreference(preference: ThemePreference): ResolvedTheme {
  try {
    const store = storage()
    if (store) {
      // 'system' is the default, so it is stored as the absence of a value
      // rather than as a third string. Nothing to clean up later.
      if (preference === 'system') store.removeItem(THEME_STORAGE_KEY)
      else store.setItem(THEME_STORAGE_KEY, preference)
    }
  } catch {
    // Private browsing, blocked storage. The paint below still happens.
  }
  const resolved = resolveTheme(preference, systemPrefersDark())
  document.documentElement.setAttribute(THEME_ATTRIBUTE, resolved)
  return resolved
}

/**
 * Call back whenever the painted theme changes, whoever changed it.
 *
 * Watches the attribute rather than exposing an event, because the head script
 * writes it too and that script has no way to reach a React context. Returns an
 * unsubscribe.
 */
export function onResolvedThemeChange(handler: (theme: ResolvedTheme) => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  let last = getResolvedTheme()
  const observer = new MutationObserver(() => {
    const next = getResolvedTheme()
    if (next === last) return
    last = next
    handler(next)
  })
  observer.observe(document.documentElement, { attributeFilter: [THEME_ATTRIBUTE] })
  return () => observer.disconnect()
}

/**
 * Call back when the preference changes in ANOTHER tab.
 *
 * Two tabs of the same site should not disagree about the theme. The storage
 * event only fires in the tabs that did not make the change, which is exactly
 * the set that needs telling.
 */
export function onStoredPreferenceChange(handler: (preference: ThemePreference) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return
    const next = e.newValue
    handler(isThemePreference(next) ? next : 'system')
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
