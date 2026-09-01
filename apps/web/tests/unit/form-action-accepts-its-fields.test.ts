import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * A form's action must not turn away on a field the form does not post.
 *
 * The Admin Notes box posts `toolId` and `adminNotes` and nothing else, and it
 * posted to saveTool, which opens `if (!name) return`. So Save Notes did
 * nothing, silently, for as long as the form existed. No error, no toast, no
 * log: the action ran, hit the guard on the second line and returned, and the
 * page revalidated to exactly what it already said. The only way to find it is
 * to type a note, press the button and then go and look in the database.
 *
 * Dropping the guard would have been the worse fix. saveTool builds its update
 * from every field on the main form, so a notes-only post would have blanked
 * the name, the summary and the type. Notes got their own action instead.
 *
 * The rule: for each admin `<form action={x}>`, collect the field names the form
 * posts, then fail when x returns early on a field that is not among them.
 *
 * HONESTLY PARTIAL, and that is on purpose. It only understands the shape the
 * admin app is actually written in: a plain <form> with an imported server
 * action, guards written as `const v = formData.get('k')` then `if (!v) return`,
 * and fields as literal `name="..."` attributes on inputs, either in the form or
 * in a component it renders. Anything cleverer than that is skipped rather than
 * guessed at, and the counts asserted below are what stop the skipping from
 * quietly growing to cover everything.
 */

const WEB_ROOT = process.cwd()
const ADMIN_DIR = join(WEB_ROOT, 'app/admin')

function walk(dir: string, ext: RegExp): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walk(full, ext))
    else if (ext.test(full)) out.push(full)
  }
  return out
}

/** Comments out, quotes kept. A `name="x"` in a doc comment is not a field. */
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

const SOURCE = new Map<string, string>(
  ['app', 'components', 'lib']
    .map((d) => join(WEB_ROOT, d))
    .filter(existsSync)
    .flatMap((d) => walk(d, /\.tsx?$/))
    .map((f) => [f, stripComments(readFileSync(f, 'utf8'))]),
)

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(WEB_ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  for (const ext of ['', ...EXTENSIONS]) {
    if (SOURCE.has(base + ext)) return base + ext
  }
  return null
}

/** Where each name a file imports comes from. */
function importSources(file: string): Map<string, string> {
  const src = SOURCE.get(file) ?? ''
  const out = new Map<string, string>()
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const module = resolveImport(file, m[2]!)
    if (!module) continue
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) out.set(name, module)
    }
  }
  return out
}

/** Body of a function or a component, skipping its parameter list properly. */
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

/** A named function declared in a file, or null. */
function functionBody(file: string, name: string): string | null {
  const src = SOURCE.get(file)
  if (!src) return null
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src)
  if (!m) return null
  return bodyAfterParams(src, m.index + m[0].length - 1)
}

/** Every component declared anywhere, by bare name, for looking up form fields. */
const COMPONENT_BODIES = new Map<string, string>()
for (const [file, src] of SOURCE) {
  for (const m of src.matchAll(/function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g)) {
    const body = bodyAfterParams(src, m.index! + m[0].length - 1)
    if (body && !COMPONENT_BODIES.has(m[1]!)) COMPONENT_BODIES.set(m[1]!, body)
  }
}

/** Literal `name="x"` attributes, plus the ones in any component it renders. */
function postedNames(markup: string, depth = 0, seen = new Set<string>()): Set<string> {
  const names = new Set<string>()
  for (const m of markup.matchAll(/\sname=["']([^"']+)["']/g)) names.add(m[1]!)
  if (depth >= 3) return names
  for (const m of markup.matchAll(/<([A-Z][A-Za-z0-9_$]*)/g)) {
    const component = m[1]!
    if (seen.has(component)) continue
    seen.add(component)
    const body = COMPONENT_BODIES.get(component)
    if (!body) continue
    for (const name of postedNames(body, depth + 1, seen)) names.add(name)
  }
  return names
}

/** True when the form builds a field name from an expression we cannot read. */
function hasComputedNames(markup: string): boolean {
  return /\sname=\{/.test(markup)
}

interface FormUse {
  file: string
  line: number
  /** The identifier in `action={...}`, with any `.bind(...)` taken off. */
  action: string
  markup: string
}

/** Every `<form action={...}>` under app/admin, with its own markup. */
function adminForms(): FormUse[] {
  const out: FormUse[] = []
  for (const file of walk(ADMIN_DIR, /\.tsx$/)) {
    const src = SOURCE.get(file) ?? ''
    for (const m of src.matchAll(/<form\s+action=\{([^}]+)\}/g)) {
      const close = src.indexOf('</form>', m.index!)
      if (close === -1) continue
      const action = m[1]!.trim().split('.bind')[0]!.trim()
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(action)) continue // a call or an inline function
      out.push({
        file,
        line: src.slice(0, m.index!).split('\n').length,
        action,
        markup: src.slice(m.index!, close),
      })
    }
  }
  return out
}

/**
 * The action's body, whether it is imported or bound to a local alias.
 *
 * `const saveAction = saveGrantForm.bind(null, id)` is how half the grant
 * editor's forms are written, so the alias has to be followed or those forms
 * are silently unchecked.
 */
function actionBody(file: string, action: string): string | null {
  const src = SOURCE.get(file) ?? ''

  const alias = new RegExp(`const\\s+${action}\\s*=\\s*([A-Za-z_$][A-Za-z0-9_$]*)`).exec(src)
  const name = alias ? alias[1]! : action

  const imported = importSources(file).get(name)
  if (imported) return functionBody(imported, name)
  return functionBody(file, name)
}

/**
 * Fields the action refuses to proceed without.
 *
 * Only the literal shape: read a field into a const, then `if (!that) return`.
 * That is what saveTool does and what every other action in the admin does when
 * it does this at all.
 */
function requiredFields(body: string): string[] {
  const fieldOf = new Map<string, string>()
  for (const m of body.matchAll(/(?:const|let)\s+([A-Za-z0-9_$]+)\s*=[^\n]*?\.get\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    fieldOf.set(m[1]!, m[2]!)
  }

  const required = new Set<string>()
  for (const m of body.matchAll(/if\s*\(\s*!\s*([A-Za-z0-9_$]+)\s*\)\s*(?:\{\s*)?return\b/g)) {
    const field = fieldOf.get(m[1]!)
    if (field) required.add(field)
  }
  for (const m of body.matchAll(/if\s*\(\s*!\s*[A-Za-z0-9_$]+\.get\(\s*['"]([^'"]+)['"]\s*\)\s*\)\s*(?:\{\s*)?return\b/g)) {
    required.add(m[1]!)
  }
  return [...required]
}

describe('a form posts every field its action insists on', () => {
  const forms = adminForms()

  it('reads the admin forms and their actions, so a silent pass means something', () => {
    // Every count here has been wrong once while this file was being written,
    // and each time the guard passed everything. If a refactor drops these
    // below the line, the guard has stopped looking rather than stopped finding.
    expect(forms.length).toBeGreaterThan(10)

    const resolved = forms.filter((f) => actionBody(f.file, f.action) !== null)
    expect(resolved.length).toBeGreaterThan(10)

    const withGuards = resolved.filter((f) => requiredFields(actionBody(f.file, f.action)!).length > 0)
    expect(withGuards.length).toBeGreaterThan(0)

    // The tool editor's main form is the one that carries the guard the notes
    // box fell foul of. If `name` stops being required there, this file is
    // watching the wrong thing.
    const toolForm = forms.find((f) => f.action === 'saveTool')
    expect(toolForm).toBeDefined()
    expect(requiredFields(actionBody(toolForm!.file, toolForm!.action)!)).toContain('name')
  })

  for (const form of forms) {
    const where = `${relative(WEB_ROOT, form.file)}:${form.line} action={${form.action}}`
    it(where, () => {
      const body = actionBody(form.file, form.action)
      if (!body) return // action written in a shape this guard does not read
      if (hasComputedNames(form.markup)) return // field names built at runtime

      const posted = postedNames(form.markup)
      const missing = requiredFields(body).filter((field) => !posted.has(field))

      expect(
        missing,
        `${where} returns early unless ${missing.map((f) => `"${f}"`).join(', ')} is set, ` +
          `and the form never posts it. Pressing the button does nothing at all, ` +
          `with no error anywhere, which is how Save Notes stayed broken. The form ` +
          `posts: ${[...posted].join(', ') || '(nothing)'}. Give this form an action ` +
          `of its own that touches only its own columns, the way saveAdminNotes does.`,
      ).toEqual([])
    })
  }
})
