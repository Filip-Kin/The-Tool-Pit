import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * A page that renders one visitor's own state must not be cached for everybody.
 *
 * The home page exported `revalidate = 60`, which was right while it was the
 * same page for every visitor. It stopped being true when the grids started
 * showing which tools YOU had bookmarked and upvoted, and again when Favorite
 * tools was added. Two things went wrong at once. Signing in and refreshing
 * could be answered out of the route cache, so the page came back signed out
 * and sign-in looked broken. And a cached payload carrying one visitor's
 * bookmark highlights could be handed to the next visitor, which is somebody
 * else's business on your screen. `/photos` had grown the same shape and was
 * fixed by hand the same day.
 *
 * The reason review keeps missing it is that the two halves are far apart. The
 * directive is one line at the top of a page, and the thing that makes it wrong
 * is three components down, inside a grid that quietly started asking who you
 * are. So it gets a test that walks the distance instead.
 *
 * The rule: if anything a page renders reaches session or cookie state, the
 * page may not export `revalidate` or `dynamic = 'force-static'`.
 *
 * The per-visitor functions are DERIVED, not listed. Anything that reads
 * `cookies()` counts, and so does anything that calls something that does, all
 * the way up. That way a new helper wrapping getCurrentUser is covered on the
 * day it is written rather than on the day somebody remembers this file.
 *
 * `/robot-code` keeps its `revalidate = 60` and must keep passing: it renders a
 * team archive and asks nothing about you.
 *
 * The root layout is deliberately outside the walk. It reads the user for the
 * sign-in button in the header, which is true of every route equally, and
 * folding it in would flag all of them and leave the rule saying nothing. This
 * guard is about a page's OWN tree, which is where the per-visitor content
 * under a page-level directive comes from.
 */

const WEB_ROOT = process.cwd()
const APP_DIR = join(WEB_ROOT, 'app')

/** Source extensions an import may resolve to, in the order Next tries them. */
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function walkDir(dir: string, match: (file: string) => boolean): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walkDir(full, match))
    else if (match(full)) out.push(full)
  }
  return out
}

const SOURCE_FILES = ['app', 'components', 'lib']
  .map((d) => join(WEB_ROOT, d))
  .filter((d) => existsSync(d))
  .flatMap((d) => walkDir(d, (f) => /\.tsx?$/.test(f)))

const SOURCE = new Map<string, string>(SOURCE_FILES.map((f) => [f, readFileSync(f, 'utf8')]))

/** `@/lib/x`, `./x` and `../x` to an absolute file. Anything else is a package. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(WEB_ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null

  for (const ext of ['', ...EXTENSIONS]) {
    const candidate = base + ext
    if (SOURCE.has(candidate)) return candidate
  }
  return null
}

/** Every local module a file imports, static or dynamic. */
function importsOf(file: string): string[] {
  const src = SOURCE.get(file) ?? ''
  const specs = new Set<string>()
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) specs.add(m[1]!)
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]!)
  const out: string[] = []
  for (const spec of specs) {
    const resolved = resolveImport(file, spec)
    if (resolved) out.push(resolved)
  }
  return out
}

/** The names a file pulls in by name, so a bare word match is not a false hit. */
function importedNames(file: string): Set<string> {
  const src = SOURCE.get(file) ?? ''
  const names = new Set<string>()
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  // `const { cookies } = await import('next/headers')` is how fingerprint.ts
  // reaches the cookie jar, and it must count the same as a static import.
  for (const m of src.matchAll(/\{([^}]*)\}\s*=\s*await\s+import\(/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim()
      if (name) names.add(name)
    }
  }
  return names
}

interface FnDef {
  name: string
  file: string
  body: string
}

/**
 * Body of every exported function in a file.
 *
 * The parameter list is skipped properly rather than jumping to the next `{`,
 * because `function f({ a }: Props)` and `function f(p: P = {})` both put a
 * brace before the body, and a reader that stops there comes back with the
 * parameters and concludes the function touches nothing.
 */
function exportedFunctions(file: string): FnDef[] {
  const src = SOURCE.get(file) ?? ''
  const out: FnDef[] = []
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
    let depth = 0
    let i = m.index! + m[0].length - 1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    const open = src.indexOf('{', i)
    if (open === -1) continue

    depth = 0
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') {
        depth--
        if (depth === 0) {
          out.push({ name: m[1]!, file, body: src.slice(open, j + 1) })
          break
        }
      }
    }
  }
  return out
}

const ALL_FUNCTIONS = SOURCE_FILES.flatMap(exportedFunctions)

/** A call to `name(` anywhere in a chunk of source. */
function calls(body: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(body)
}

/**
 * Functions that reach the visitor's cookies, and functions that reach those.
 *
 * Seeded on `cookies()` because that is the only door: a session, a vote
 * fingerprint and an admin check all go through the same jar. Then closed under
 * calling, so getCurrentUser is per-visitor because it reads the jar,
 * getFavoritedIds because it calls getCurrentUser, and whatever gets written
 * next because it calls one of those.
 */
function perVisitorFunctions(): Map<string, FnDef> {
  const tainted = new Map<string, FnDef>()
  for (const fn of ALL_FUNCTIONS) {
    if (calls(fn.body, 'cookies')) tainted.set(fn.name, fn)
  }
  let grew = true
  while (grew) {
    grew = false
    for (const fn of ALL_FUNCTIONS) {
      if (tainted.has(fn.name)) continue
      const imported = importedNames(fn.file)
      for (const name of tainted.keys()) {
        if (name === fn.name) continue
        if (!imported.has(name)) continue
        if (!calls(fn.body, name)) continue
        tainted.set(fn.name, fn)
        grew = true
        break
      }
    }
  }
  return tainted
}

const PER_VISITOR = perVisitorFunctions()

/** `export const revalidate = 60` or `export const dynamic = 'force-static'`. */
function cacheDirective(src: string): string | null {
  const revalidate = src.match(/export\s+const\s+revalidate\s*=\s*([^\n]+)/)
  if (revalidate) return `revalidate = ${revalidate[1]!.trim().replace(/;$/, '')}`
  const dynamic = src.match(/export\s+const\s+dynamic\s*=\s*['"]force-static['"]/)
  if (dynamic) return `dynamic = 'force-static'`
  return null
}

/**
 * The first per-visitor call reachable from a page, with the path that got
 * there, or null. The path is what makes a failure actionable: the page itself
 * usually looks innocent.
 */
function findPerVisitorUse(page: string): string | null {
  const queue: Array<{ file: string; trail: string[] }> = [{ file: page, trail: [] }]
  const seen = new Set<string>([page])

  while (queue.length > 0) {
    const { file, trail } = queue.shift()!
    const src = SOURCE.get(file) ?? ''
    const imported = importedNames(file)
    const here = [...trail, relative(WEB_ROOT, file)]

    for (const [name, def] of PER_VISITOR) {
      // Skip the file that defines it: defining getCurrentUser is not using it.
      if (def.file === file) continue
      if (!imported.has(name) && !(name === 'cookies' && src.includes('cookies('))) continue
      if (!calls(src, name)) continue
      return `${here.join(' -> ')} calls ${name}() (${relative(WEB_ROOT, def.file)})`
    }

    for (const next of importsOf(file)) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push({ file: next, trail: here })
    }
  }
  return null
}

describe('a page that renders per-visitor content is not cached', () => {
  const pages = walkDir(APP_DIR, (f) => f.endsWith('/page.tsx'))

  it('finds the pages and the cookie readers, so a silent pass means something', () => {
    // A regex guard that quietly matched nothing would pass forever.
    expect(pages.length).toBeGreaterThan(50)
    expect(PER_VISITOR.has('getCurrentUser')).toBe(true)
    expect(PER_VISITOR.has('getVotedToolIds')).toBe(true)
    expect(PER_VISITOR.has('getFavoritedIds')).toBe(true)
    expect(PER_VISITOR.has('listingClaimStates')).toBe(true)
    expect(PER_VISITOR.has('currentVoterFingerprint')).toBe(true)
  })

  for (const page of pages) {
    // Route groups are not URL segments, so `(public)/frc/page.tsx` is /frc.
    const route =
      relative(APP_DIR, page)
        .replace(/\/page\.tsx$/, '')
        .split('/')
        .filter((seg) => !seg.startsWith('('))
        .join('/') || ''
    it(`/${route}`, () => {
      const directive = cacheDirective(SOURCE.get(page) ?? '')
      if (!directive) return // dynamic by default, or force-dynamic, both fine

      const use = findPerVisitorUse(page)
      expect(
        use,
        `/${route} exports \`${directive}\` and renders per-visitor state:\n  ${use}\n` +
          `A shared cache of that serves one visitor's session to the next, and makes ` +
          `signing in look broken. Use \`export const dynamic = 'force-dynamic'\`.`,
      ).toBeNull()
    })
  }
})
