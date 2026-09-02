/**
 * Guard: a prompt may not offer the model a value its validator rejects.
 *
 * This is vocabulary drift in a different medium, and it produced the worst
 * example on the site. The tool classifier's prompt listed event pages under
 * "these are NOT tools" and, twenty lines later, offered an "offseason_event"
 * bucket to file them in. The model used the bucket. Six events reached the
 * public catalogue and one of them led Rookie Friendly on the home page.
 *
 * The grants prompts have the same shape: each file imports its enums for the
 * validator and then types the same words out again inside the prompt string.
 * Nothing checks that the two agree.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GRANT_AWARD_MAX,
  GRANT_AWARD_MIN,
  ALERT_KINDS,
} from '@the-tool-pit/db/grant-enums'

const GRANTS = join(import.meta.dir, '../src/grants')

function read(file: string): string {
  return readFileSync(join(GRANTS, file), 'utf8')
}

describe('grant award bounds', () => {
  it('are one pair, shared by every reader', () => {
    // The candidate extractor and the classifier accepted up to 100,000,000
    // while the monitor's re-read of the same page dropped anything over
    // 5,000,000, so an award recorded on the first pass could vanish on the
    // second with nothing logged. A factor of twenty between producer and
    // consumer.
    const offenders: string[] = []
    for (const file of ['extract.ts', 'classify.ts', 'candidate-extract.ts', 'monitor.ts']) {
      const source = read(file)
      for (const literal of ['100_000_000', '5_000_000']) {
        if (source.includes(literal)) offenders.push(`${file} hardcodes ${literal}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('are a sane window', () => {
    expect(GRANT_AWARD_MIN).toBeGreaterThan(0)
    expect(GRANT_AWARD_MAX).toBeGreaterThan(GRANT_AWARD_MIN)
  })
})

describe('alert kinds', () => {
  it('all have a renderer', () => {
    // A kind with no renderer reaches the outbox and parks there with "no email
    // body for kind ...". 'digest' was in the tuple with neither a producer nor
    // a renderer.
    const alerts = read('alerts.ts')
    const rendered = new Set(
      [...alerts.matchAll(/case '(\w+)':/g)].map((m) => m[1]),
    )
    const missing = ALERT_KINDS.filter((kind) => !rendered.has(kind))
    expect(missing).toEqual([])
  })
})

describe('grant prompts', () => {
  /**
   * Vocabularies a file imports for its validator, and whether the prompt in
   * the same file interpolates them or types them out again.
   *
   * Typing them again is exactly how the tool classifier ended up offering an
   * "offseason_event" bucket in a prompt whose own rules said an event is not a
   * tool. The validator and the words the model reads have to come from one
   * place, and interpolation is the only way to guarantee it.
   */
  const PROMPT_FILES = ['extract.ts', 'classify.ts', 'candidate-extract.ts']

  it('interpolate every vocabulary they import rather than restating it', () => {
    const offenders: string[] = []

    for (const file of PROMPT_FILES) {
      const source = read(file)

      // Constants imported from the db package, by name. BOTH spellings: the
      // subpath and the barrel. Checking only the subpath found nothing in
      // these three files, because the vocabularies come through the barrel,
      // and the guard passed while both prompts still spelled them out.
      const imports = [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'@the-tool-pit\/db(?:\/grant-enums)?'/g)]
      const names = imports
        .flatMap((m) => m[1].split(','))
        .map((n) => n.trim())
        .filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n))

      const prompt = source.slice(source.indexOf('SYSTEM_PROMPT') === -1 ? 0 : source.indexOf('SYSTEM_PROMPT'))

      for (const name of names) {
        // A tuple of words the model has to choose from. A numeric bound is not
        // a vocabulary and does not belong in the prompt as a list.
        if (!name.endsWith('_TYPES') && !name.endsWith('_KINDS') && !name.endsWith('_LEVELS')) continue
        const values = source.match(new RegExp(`${name}\\b`, 'g')) ?? []
        if (values.length < 2) continue
        if (!prompt.includes(`\${${name}`)) {
          offenders.push(`${file}: the prompt does not interpolate ${name}, so it is spelled out twice`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
