/**
 * The theme preference, and the one rule that turns it into a colour scheme.
 *
 * THREE STATES, NOT TWO. "Follow the system" is a real answer and it is the
 * default: someone whose laptop goes light at sunrise expects this site to go
 * with it, and they should not have to come back here to say so. Forcing light
 * or dark is the override, and an override sticks until it is changed.
 *
 * No DOM in this file. The resolver runs in three places that do not share an
 * environment: the inline script in the document head (as a string, below), the
 * React control, and the unit tests. Keeping it a pure function of
 * (preference, what the OS says) is what lets those three agree.
 */

export type ThemePreference = 'system' | 'light' | 'dark'

/** What actually gets painted. There is no third option here. */
export type ResolvedTheme = 'light' | 'dark'

/**
 * localStorage key. Namespaced because frc.tools serves six verticals from one
 * origin and they share this storage.
 */
export const THEME_STORAGE_KEY = 'toolpit:theme'

/** The attribute the resolved theme is written to on <html>. */
export const THEME_ATTRIBUTE = 'data-theme'

/** The media query that answers "what does the OS want". */
export const DARK_QUERY = '(prefers-color-scheme: dark)'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/**
 * The rule. A stored 'light' or 'dark' wins outright; 'system' hands the
 * decision to the OS.
 */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

/**
 * Read the stored preference, treating every failure as "no preference".
 *
 * localStorage is not always there to be read. Safari in private browsing used
 * to throw on write, blocked third-party storage throws on access, and a
 * visitor who has turned cookies off gets a SecurityError on the getter itself,
 * before any method is called. A theme is not worth a thrown exception in the
 * document head, so anything unexpected means 'system' and the OS decides.
 */
export function readStoredPreference(getStorage: () => Storage | null | undefined): ThemePreference {
  try {
    const stored = getStorage()?.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

/**
 * The script that runs in the document head, as a string.
 *
 * It has to be inline and it has to be in the head, because the theme has to be
 * decided BEFORE the first paint. Doing this in a useEffect paints the dark
 * theme and then repaints light: a white flash on a light-theme machine, on
 * every navigation that reloads the document. That flash is the entire reason
 * this file exists.
 *
 * It also subscribes to the media query, so "follow the system" follows the
 * system live rather than only at load. That listener lives here rather than in
 * the React control for a plain reason: the control is in the site headers, and
 * not every route renders one. The head script is on every page there is.
 *
 * Built from the constants above so the key, the attribute and the query cannot
 * drift from the TypeScript that reads them back. Written defensively
 * throughout: a throw here stops the document parse, and a theme is not worth
 * a blank page.
 */
export const THEME_INIT_SCRIPT = [
  '(function(){',
  `var K=${JSON.stringify(THEME_STORAGE_KEY)},A=${JSON.stringify(THEME_ATTRIBUTE)},Q=${JSON.stringify(DARK_QUERY)};`,
  'function a(){',
  'var p="system";',
  'try{var s=window.localStorage.getItem(K);if(s==="light"||s==="dark")p=s}catch(e){}',
  'var t=p;',
  'if(p==="system"){t="dark";try{if(!window.matchMedia(Q).matches)t="light"}catch(e){}}',
  'document.documentElement.setAttribute(A,t);',
  '}',
  'a();',
  'try{var m=window.matchMedia(Q);',
  'if(m.addEventListener)m.addEventListener("change",a);',
  'else if(m.addListener)m.addListener(a);}catch(e){}',
  '})()',
].join('')
