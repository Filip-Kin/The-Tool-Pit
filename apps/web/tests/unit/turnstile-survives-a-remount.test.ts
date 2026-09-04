import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "Submit another" has to give you a form you can actually submit.
 *
 * A successful submit replaces the whole form with a confirmation, which takes
 * the Turnstile container down with it. Every form then re-rendered the widget
 * from a useEffect keyed on values that do not change when the form comes
 * back, so the widget never returned. No widget, no token; no token, a submit
 * button that can never be enabled. The second event, field, grant or
 * repository could not be submitted at all without reloading the page, and
 * nothing on screen said why.
 *
 * Reproduced on the events, grants and robot-code forms before the fix, with
 * Cloudflare's test keys, by submitting once and pressing "Submit another".
 *
 * The fix is one hook whose rendering hangs off a CALLBACK REF, so a container
 * arriving is what draws the widget, every time one arrives. What is pinned
 * here is the shape that makes remounting a non-event:
 *
 *   - one implementation, so a seventh form cannot reintroduce this,
 *   - the container is a callback ref, not a useRef read inside an effect,
 *   - the widget is removed when its container goes.
 */

const WEB_ROOT = process.cwd()
const HOOK = 'components/ui/use-turnstile.ts'

const FORMS = [
  'components/submit/submit-form.tsx',
  'components/robot-code/robot-code-submit-form.tsx',
  'components/albums/album-submit-form.tsx',
  'components/fields/field-submit-form.tsx',
  'components/events/event-submit-form.tsx',
  'components/grants/grant-submit-form.tsx',
]

function read(path: string): string {
  return readFileSync(join(WEB_ROOT, path), 'utf8')
}

describe('the Turnstile hook', () => {
  const src = read(HOOK)

  it('draws the widget from a callback ref, not from an effect', () => {
    // An effect fires on the dependencies it was given. A callback ref fires
    // on the thing that actually matters here: a container appearing.
    expect(src).toMatch(/containerRef = useCallback\(/)
    expect(src).not.toMatch(/useEffect/)
  })

  it('takes the widget down with its container', () => {
    expect(src).toMatch(/if \(!node\)/)
    expect(src).toMatch(/turnstile\.remove\(/)
  })

  it('loads the script once, however many forms mount', () => {
    expect(src).toMatch(/getElementById\(SCRIPT_ID\)/)
  })
})

describe.each(FORMS)('%s', (path) => {
  const src = read(path)

  it('uses the shared hook rather than its own widget lifecycle', () => {
    expect(src).toMatch(/useTurnstile\(/)
    // The four things every copy used to carry. Any of them coming back means
    // a form is running its own lifecycle again.
    expect(src).not.toMatch(/window\.turnstile\.render\(/)
    expect(src).not.toMatch(/widgetIdRef/)
    expect(src).not.toMatch(/turnstileRef/)
    expect(src).not.toMatch(/declare global/)
  })

  it('gates its submit button on the hook', () => {
    expect(src).toMatch(/turnstile\.required && !turnstile\.token/)
  })
})
