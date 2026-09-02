/**
 * Guard: a client component may not import the database barrel.
 *
 * '@the-tool-pit/db' re-exports the postgres client, so a 'use client' file
 * that reads one constant from it drags the driver into the browser bundle and
 * the build dies on "Can't resolve 'fs'". The failure names a node builtin
 * rather than the import that caused it, so it reads like a bundler problem.
 *
 * The package already answers this: field-enums, grant-enums, event-enums,
 * robot-code-enums, human-edited, tool-enums and audience-enums are subpaths
 * with no imports at all. This test says so out loud, at the moment the mistake
 * is made rather than four minutes into a build.
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '../../../..')
const WEB = join(REPO, 'apps/web')
const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'tests'])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** A file is a client component when its first statement says so. */
function isClientComponent(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use client['"]/.test(source)
}

/**
 * A value import, as opposed to `import type`, which is erased before bundling.
 *
 * Matched one line at a time. This file has no semicolons, like the rest of the
 * codebase, so a pattern of `[^;]*` between `import` and the module name ran
 * across every line in between and reported six `import type` lines as value
 * imports by starting from a completely unrelated `import Link from ...`.
 */
function importsBarrelValues(source: string): boolean {
  return source
    .split('\n')
    .some((line) => /^\s*import\s+(?!type\b)[^\n]*from\s+'@the-tool-pit\/db'\s*$/.test(line))
}

describe('client components', () => {
  const files = sourceFiles(WEB)

  it('are actually being found', () => {
    const clients = files.filter((f) => isClientComponent(readFileSync(f, 'utf8')))
    expect(clients.length).toBeGreaterThan(20)
  })

  it('reach for a subpath rather than the barrel', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!isClientComponent(source)) continue
      if (importsBarrelValues(source)) {
        offenders.push(
          `${file.slice(REPO.length + 1)} imports values from '@the-tool-pit/db'; use a subpath such as @the-tool-pit/db/tool-enums`,
        )
      }
    }
    expect(offenders).toEqual([])
  })

  it('may still import types from the barrel', () => {
    // `import type` is erased before bundling, so it costs nothing and several
    // client components legitimately do it.
    expect(importsBarrelValues("import type { Tool } from '@the-tool-pit/db'")).toBe(false)
    expect(importsBarrelValues("import { tools } from '@the-tool-pit/db'")).toBe(true)
  })
})
