import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * A button never goes inside a link.
 *
 * Shipped twice in one day, in components/albums/album-card.tsx and then again
 * in components/albums/event-card.tsx. The card was the anchor and the three
 * dot menu sat inside it, so clicking the menu opened the menu AND opened the
 * album. It is invalid HTML as well: an <a> may not contain a button, and what
 * the browser does with it is its own business.
 *
 * The fix both times is the stretched link, and components/tools/tool-card.tsx
 * is the reference. The anchor is a SIBLING of the content with
 * `absolute inset-0`, covering the tile from behind, and the controls sit above
 * it with `relative z-10`. Nothing is nested inside anything.
 *
 * The rule: no interactive element inside the children of an <a> or a <Link>.
 *
 * Interactive is DERIVED, not listed. The intrinsic controls seed it, then any
 * component whose own markup renders one is interactive too, and so on up. That
 * is how AlbumMenu, FavoriteButton and VoteButton are known without this file
 * naming them, and how the next card control is known on the day it is written.
 */

const WEB_ROOT = process.cwd()

function walk(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const FILES = ['app', 'components'].flatMap((d) => walk(join(WEB_ROOT, d)))

/**
 * Comments out, quotes kept.
 *
 * Needed because components/ui/button.tsx says "Renders an <a> when given href,
 * a <button> otherwise" in its doc comment, and a scanner that believes it
 * reports the one file in the app that documents the rule. Written as a walk
 * rather than a regex because `//` inside 'https://...' is not a comment, and
 * deleting the rest of that line eats the tags after it.
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
      continue
    }
    const c = src[i]!
    if (c === '"' || c === "'" || c === '`') {
      out += c
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          out += src[i]! + (src[i + 1] ?? '')
          i += 2
          continue
        }
        out += src[i]
        i++
      }
      out += c
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

type TagKind = 'open' | 'close' | 'self'
interface Tag {
  name: string
  kind: TagKind
  line: number
  /** Offset of the `<`. */
  start: number
  /** Offset just past the `>`. */
  end: number
}

/**
 * Every JSX tag in a file, in order.
 *
 * Attribute-aware on purpose: `onClick={() => close()}` contains a `>`, so a
 * regex that stops at the first one calls a self-closing control an opening tag
 * and then hunts for a closing tag that never comes. The nesting stack is the
 * whole guard, so it has to be right. Braces and quotes are tracked to find the
 * `>` that really ends the tag.
 */
function scanTags(src: string): Tag[] {
  const tags: Tag[] = []
  const lineAt = (index: number): number => src.slice(0, index).split('\n').length

  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue
    const isClose = src[i + 1] === '/'
    const nameStart = i + (isClose ? 2 : 1)
    const nameMatch = /^[A-Za-z][A-Za-z0-9_.]*/.exec(src.slice(nameStart, nameStart + 64))
    if (!nameMatch) continue
    const name = nameMatch[0]

    let j = nameStart + name.length
    let depth = 0
    let quote: string | null = null
    for (; j < src.length; j++) {
      const c = src[j]!
      if (quote) {
        if (c === '\\') j++
        else if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    if (j >= src.length) continue

    const selfClosing = src[j - 1] === '/'
    tags.push({
      name,
      kind: isClose ? 'close' : selfClosing ? 'self' : 'open',
      line: lineAt(i),
      start: i,
      end: j + 1,
    })
    i = j
  }
  return tags
}

/** Anchors. `Link` is next/link, which renders one. */
const ANCHOR_TAGS = new Set(['a', 'Link'])

/**
 * The controls a browser will not let you nest inside an anchor. `summary` is
 * here because it is the click target of a details element.
 */
const INTRINSIC_CONTROLS = new Set(['button', 'input', 'select', 'textarea', 'a', 'Link', 'summary'])

/** Radix trigger components all render a button underneath. */
function isTrigger(name: string): boolean {
  return name.endsWith('Trigger')
}

/**
 * Body of a function, given the index of its parameter list's `(`.
 *
 * The parameters have to be skipped properly rather than jumping to the next
 * `{`: every component here is `function Name({ a, b }: Props)`, so the next
 * brace is the destructuring pattern and a naive reader comes back with the
 * props instead of the markup, and then believes nothing renders a button.
 */
function bodyAfterParams(src: string, parenIndex: number): string | null {
  let depth = 0
  let i = parenIndex
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) break
    }
  }
  const open = src.indexOf('{', i)
  if (open === -1) return null

  depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) return src.slice(open, j + 1)
    }
  }
  return null
}

/** The components each file declares, with the markup they render. */
function componentBodies(file: string, src: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of src.matchAll(/(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g)) {
    const body = bodyAfterParams(src, m.index! + m[0].length - 1)
    if (body) out.set(`${file}#${m[1]!}`, body)
  }
  return out
}

const STRIPPED = new Map<string, string>(FILES.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]))
const COMPONENTS = new Map<string, string>()
for (const [file, src] of STRIPPED) for (const [key, body] of componentBodies(file, src)) COMPONENTS.set(key, body)

/**
 * Component names that render a control, closed under composition.
 *
 * Keyed on the bare name rather than the module, because a JSX tag is a bare
 * name and two components in this app do not share one.
 */
function interactiveComponents(): Set<string> {
  const interactive = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const [key, body] of COMPONENTS) {
      const name = key.split('#')[1]!
      if (interactive.has(name)) continue
      const renders = scanTags(body).filter((t) => t.kind !== 'close')
      const hit = renders.some(
        (t) => INTRINSIC_CONTROLS.has(t.name) || isTrigger(t.name) || interactive.has(t.name),
      )
      if (hit) {
        interactive.add(name)
        grew = true
      }
    }
  }
  return interactive
}

const INTERACTIVE = interactiveComponents()

function isControl(name: string): boolean {
  return INTRINSIC_CONTROLS.has(name) || isTrigger(name) || INTERACTIVE.has(name)
}

/**
 * Local variables holding markup, and the controls in that markup.
 *
 * The event card kept its menu in a `const menu = ... <AlbumMenu /> ...` above
 * the return and rendered `{menu}` inside the Link. Tag nesting alone sees a
 * Link containing an expression and nothing else, so the second half of the
 * same afternoon's bug would have walked straight past this guard. The
 * expression ends at the first newline where every bracket is closed, which is
 * how the ternary that builds that menu is written.
 */
function markupVariables(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of src.matchAll(/\bconst\s+([a-z][A-Za-z0-9_$]*)\s*=/g)) {
    let depth = 0
    let i = m.index! + m[0].length
    for (; i < src.length; i++) {
      const c = src[i]!
      if (c === '(' || c === '{' || c === '[') depth++
      else if (c === ')' || c === '}' || c === ']') depth--
      else if (c === '\n' && depth <= 0 && i > m.index! + m[0].length) break
    }
    const controls = scanTags(src.slice(m.index!, i))
      .filter((t) => t.kind !== 'close' && isControl(t.name))
      .map((t) => t.name)
    if (controls.length > 0) out.set(m[1]!, [...new Set(controls)])
  }
  return out
}

interface Offence {
  file: string
  line: number
  /** Already phrased, because a variable holding markup does not read as a tag. */
  what: string
  anchor: string
  anchorLine: number
}

/** Controls found inside the children of an anchor, with both line numbers. */
function controlsInsideAnchors(file: string, src: string): Offence[] {
  const offences: Offence[] = []
  const variables = markupVariables(src)
  const open: Array<{ name: string; line: number }> = []
  const anchors: Array<{ name: string; line: number; childrenStart: number }> = []

  const report = (line: number, what: string) => {
    const anchor = anchors[anchors.length - 1]!
    offences.push({ file, line, what, anchor: anchor.name, anchorLine: anchor.line })
  }

  for (const tag of scanTags(src)) {
    if (tag.kind !== 'close') {
      if (anchors.length > 0 && isControl(tag.name)) report(tag.line, `<${tag.name}>`)
      if (tag.kind === 'open') {
        open.push({ name: tag.name, line: tag.line })
        if (ANCHOR_TAGS.has(tag.name)) {
          anchors.push({ name: tag.name, line: tag.line, childrenStart: tag.end })
        }
      }
      continue
    }
    // A close tag. Unwind to the matching open, so a stray one cannot leave the
    // stack believing it is still inside an anchor for the rest of the file.
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i]!.name !== tag.name) continue
      if (ANCHOR_TAGS.has(tag.name)) {
        const anchor = anchors.pop()
        if (anchor) {
          const children = src.slice(anchor.childrenStart, tag.start)
          for (const [variable, controls] of variables) {
            if (!new RegExp(`\\b${variable}\\b`).test(children)) continue
            offences.push({
              file,
              line: anchor.line,
              what: `{${variable}}, which renders <${controls.join('>, <')}>,`,
              anchor: anchor.name,
              anchorLine: anchor.line,
            })
          }
        }
      }
      open.length = i
      break
    }
  }
  return offences
}

describe('no interactive control inside a link', () => {
  it('knows what a control is, so a silent pass means something', () => {
    // If the derivation broke, every file below would pass for the wrong
    // reason. These are the three controls that sit on the cards this rule is
    // about, and none of them is named anywhere else in this file.
    expect(INTERACTIVE.has('AlbumMenu')).toBe(true)
    expect(INTERACTIVE.has('FavoriteButton')).toBe(true)
    expect(INTERACTIVE.has('VoteButton')).toBe(true)
    expect(FILES.length).toBeGreaterThan(50)
  })

  it('every card keeps its controls out of its anchor', () => {
    const offences: string[] = []
    for (const [file, src] of STRIPPED) {
      for (const o of controlsInsideAnchors(file, src)) {
        offences.push(
          `${relative(WEB_ROOT, file)}:${o.line}: ${o.what} is inside the <${o.anchor}> opened at line ${o.anchorLine}`,
        )
      }
    }

    expect(
      offences,
      `A control inside an anchor is invalid HTML, and a click on it does both ` +
        `things: opening the menu also opened the album. Use the stretched link ` +
        `instead, as components/tools/tool-card.tsx does. The anchor becomes a ` +
        `SIBLING with \`absolute inset-0\` and the controls sit above it with ` +
        `\`relative z-10\`.\n${offences.join('\n')}`,
    ).toEqual([])
  })
})
