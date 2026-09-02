import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The claim button drifted once too often.
 *
 * Every vertical (events, fields, tools, albums) shows a "claim this listing"
 * affordance. They are meant to be ONE shared component parameterised by the
 * vertical, differing only where a vertical genuinely needs it. The bug that
 * kept coming back was never a second implementation — it was a shared prop
 * left OPTIONAL WITH A DEFAULT. `claimState = 'signed_out'` on EventDialog let
 * the events explorer render without ever passing a real state, so a signed-in
 * reader was asked to log in again to claim. A default that looks sensible is
 * how a missing wire hides.
 *
 * So two rules, pinned here as a build-breaking guard:
 *  1. The claim affordance is the shared ClaimListingButton / claimAffordance,
 *     not a per-vertical reimplementation.
 *  2. No component gives a claim-state prop a DEFAULT. It is required, so the
 *     compiler forces every caller to thread a real value. This test catches a
 *     regression a `= 'signed_out'` default would reintroduce before it ships.
 */

const WEB_ROOT = join(__dirname, '..', '..')
const SRC_DIRS = ['app', 'components'].map((d) => join(WEB_ROOT, d))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full)
  }
  return out
}

const files = SRC_DIRS.flatMap(walk)

describe('every claim button is the one shared component, with no masking default', () => {
  it('finds the source tree, so a silent pass means something', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('renders the claim affordance only through the shared ClaimListingButton / claimAffordance', () => {
    // A component whose name announces a claim button but that does not route
    // through the shared primitives would be a parallel implementation.
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const declaresClaimButton = /export function \w*Claim\w*(Button|Link)\b/.test(src)
      if (!declaresClaimButton) continue
      const routesThroughShared =
        /ClaimListingButton|claimAffordance|SignInDialog|claim-affordance/.test(src)
      const isTheSharedOne = /claim-listing-button|claim-sign-in-link/.test(relative(WEB_ROOT, file))
      if (!routesThroughShared && !isTheSharedOne) offenders.push(relative(WEB_ROOT, file))
    }
    expect(offenders, `bespoke claim UI not using the shared primitives: ${offenders.join(', ')}`).toEqual([])
  })

  it('never defaults a claim-state prop — it must be required so omission is a compile error', () => {
    // The exact shape of the bug: `claimState = 'signed_out'` (or any default)
    // in a component prop destructure. A default lets a caller skip the wire.
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      // `claimState = ...` or `state = 'signed_out'` inside a props destructure.
      if (/\bclaimState\s*=\s*['"`]/.test(src)) offenders.push(`${relative(WEB_ROOT, file)}: claimState has a default`)
      if (/\bstate\s*=\s*['"`]signed_out['"`]/.test(src)) offenders.push(`${relative(WEB_ROOT, file)}: state defaults to signed_out`)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
