import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A theme token must not take a name Tailwind has already given a keyword.
 *
 * `--color-current` was the freshness green. Tailwind v4 builds a utility for
 * every `--color-*` in the theme, so that one token quietly redefined
 * `text-current`, `bg-current`, `border-current` and `fill-current` from the CSS
 * `currentColor` keyword into a fixed green. Those classes are everywhere: a
 * `fill-current` icon is how a filled heart and a filled bookmark are drawn, so
 * both of them shipped green in production and nobody noticed, because green
 * looks deliberate. The token is called `--color-fresh` now.
 *
 * What makes it worth a test is that nothing announces it. The CSS is valid, the
 * class is valid, no build step complains, and the only symptom is a colour
 * somewhere else in the app that looks like somebody chose it.
 *
 * The reserved names are the three CSS-wide keywords Tailwind maps to colours,
 * read from the installed Tailwind rather than remembered:
 * node_modules/tailwindcss/dist/default-theme.js opens
 * `{inherit:"inherit",current:"currentcolor",transparent:"transparent",...}`.
 *
 * `black` and `white` are next in that list and are deliberately NOT reserved
 * here. They are ordinary colours with ordinary values, so redefining one is a
 * choice a designer can make. `current` is not a colour at all, it is "whatever
 * colour the surrounding text is", and no value can stand in for it.
 */

/**
 * Names that mean something other than a colour, so a token cannot have them.
 *
 * Kept as a literal list rather than read out of node_modules at test time: the
 * test would then pass by reading nothing if the file moved, which is the one
 * way a guard fails silently. The provenance is in the comment above.
 */
const RESERVED = ['inherit', 'current', 'transparent']

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

/** Every `--color-*` the theme declares, in every block of the file. */
function declaredColourTokens(css: string): string[] {
  return [...css.matchAll(/--color-([a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!)
}

describe('theme tokens do not shadow a Tailwind colour keyword', () => {
  const tokens = declaredColourTokens(CSS)

  it('reads the tokens, so a silent pass means something', () => {
    // A regex that matched nothing would pass this file forever.
    expect(tokens.length).toBeGreaterThan(30)
    expect(tokens).toContain('background')
    expect(tokens).toContain('primary')
  })

  for (const reserved of RESERVED) {
    it(`no --color-${reserved}`, () => {
      expect(
        tokens.includes(reserved),
        `app/globals.css declares --color-${reserved}. Tailwind builds ` +
          `text-${reserved}, bg-${reserved}, border-${reserved} and ` +
          `fill-${reserved} from it, which replaces the CSS \`${reserved}\` ` +
          `keyword with a fixed colour everywhere those classes are used. ` +
          `--color-current did exactly that and turned every fill-current icon ` +
          `green. Give the token a name of its own, the way --color-fresh is ` +
          `the freshness green.`,
      ).toBe(false)
    })
  }
})
