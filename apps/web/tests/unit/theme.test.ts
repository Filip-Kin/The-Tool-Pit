import { describe, it, expect } from 'vitest'
import {
  DARK_QUERY,
  THEME_ATTRIBUTE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  type ThemePreference,
} from '@/lib/theme/theme'

/**
 * The resolver is shared by three things that never meet: the inline script in
 * the document head, the React control, and this file. If they ever disagree,
 * the visitor gets a flash of the wrong theme, so the rule is pinned here.
 */

/** A localStorage stand-in holding one value. */
function fakeStorage(value: string | null): Storage {
  return {
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null),
  } as unknown as Storage
}

/** Storage that throws on access, the way a blocked-cookies browser does. */
function throwingStorage(): Storage {
  return {
    getItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  } as unknown as Storage
}

describe('resolveTheme', () => {
  it('follows the system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('ignores the system when the preference is forced', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('isThemePreference', () => {
  it('accepts the three states and nothing else', () => {
    for (const v of ['system', 'light', 'dark']) expect(isThemePreference(v)).toBe(true)
    for (const v of [null, undefined, '', 'DARK', 'auto', 0, {}]) expect(isThemePreference(v)).toBe(false)
  })
})

describe('readStoredPreference', () => {
  it('reads a stored preference back', () => {
    for (const v of ['light', 'dark', 'system'] as ThemePreference[]) {
      expect(readStoredPreference(() => fakeStorage(v))).toBe(v)
    }
  })

  it('defaults to system when nothing is stored', () => {
    expect(readStoredPreference(() => fakeStorage(null))).toBe('system')
  })

  it('defaults to system when the stored value is not one of the three', () => {
    expect(readStoredPreference(() => fakeStorage('midnight'))).toBe('system')
  })

  it('defaults to system when there is no storage at all', () => {
    expect(readStoredPreference(() => null)).toBe('system')
    expect(readStoredPreference(() => undefined)).toBe('system')
  })

  it('defaults to system when reading storage throws', () => {
    // Private browsing and blocked cookies both surface as a throw, sometimes
    // on the property access rather than on getItem. Either way the visitor
    // gets the OS setting, not an exception in the document head.
    expect(readStoredPreference(() => throwingStorage())).toBe('system')
    expect(
      readStoredPreference(() => {
        throw new DOMException('Access denied.', 'SecurityError')
      }),
    ).toBe('system')
  })
})

describe('THEME_INIT_SCRIPT', () => {
  it('carries the same key, attribute and query the TypeScript uses', () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY))
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_ATTRIBUTE))
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(DARK_QUERY))
  })

  it('cannot break out of the inline <script> it is written into', () => {
    expect(THEME_INIT_SCRIPT).not.toContain('</')
  })

  it('resolves the same three states the resolver does, in a fake document', () => {
    // Run the real script string against hand-built globals, once per case, and
    // check the attribute it leaves behind.
    const run = (stored: string | null, prefersDark: boolean, storageThrows = false) => {
      const html: Record<string, string> = {}
      const listeners: (() => void)[] = []
      const scope = {
        document: {
          documentElement: {
            setAttribute: (k: string, v: string) => {
              html[k] = v
            },
          },
        },
        window: {
          localStorage: {
            getItem: (key: string) => {
              if (storageThrows) throw new Error('blocked')
              return key === THEME_STORAGE_KEY ? stored : null
            },
          },
          matchMedia: (query: string) => ({
            matches: query === DARK_QUERY ? prefersDark : false,
            addEventListener: (_: string, fn: () => void) => listeners.push(fn),
          }),
        },
      }
      new Function('document', 'window', THEME_INIT_SCRIPT)(scope.document, scope.window)
      return { theme: html[THEME_ATTRIBUTE], listeners }
    }

    expect(run(null, true).theme).toBe('dark')
    expect(run(null, false).theme).toBe('light')
    expect(run('system', true).theme).toBe('dark')
    expect(run('system', false).theme).toBe('light')
    expect(run('light', true).theme).toBe('light')
    expect(run('dark', false).theme).toBe('dark')
    // Storage unreadable: fall through to the OS rather than throwing.
    expect(run('light', false, true).theme).toBe('light')
    expect(run('light', true, true).theme).toBe('dark')
  })

  it('subscribes to the system query so following the system stays live', () => {
    const { listeners } = (() => {
      const html: Record<string, string> = {}
      const listeners: (() => void)[] = []
      let prefersDark = true
      const doc = {
        documentElement: {
          setAttribute: (k: string, v: string) => {
            html[k] = v
          },
        },
      }
      const win = {
        localStorage: { getItem: () => null },
        matchMedia: () => ({
          get matches() {
            return prefersDark
          },
          addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        }),
      }
      new Function('document', 'window', THEME_INIT_SCRIPT)(doc, win)
      expect(html[THEME_ATTRIBUTE]).toBe('dark')
      // The OS goes light while the page is open.
      prefersDark = false
      for (const fn of listeners) fn()
      expect(html[THEME_ATTRIBUTE]).toBe('light')
      return { listeners }
    })()
    expect(listeners).toHaveLength(1)
  })
})
