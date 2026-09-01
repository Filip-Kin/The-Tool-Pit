import { describe, it, expect } from 'vitest'
import { missingForPublish } from '../src/pipeline/publish.js'

/**
 * The gate that answers the second half of the junk problem.
 *
 * Duplicates came from extract.ts picking the wrong GitHub link. Incomplete
 * entries came from here: publishing decided on classifier confidence alone,
 * and that score answers "is this FRC related", which sat around 0.83 for
 * almost everything. 500 of 1110 published listings had no usable summary as a
 * result. The gate checks that a field is THERE, not how long it is.
 */
describe('missingForPublish', () => {
  const good = {
    name: 'AdvantageKit',
    summary: 'A logging and replay framework for FRC robot code, with deterministic replay of a match.',
    url: 'https://github.com/Mechanical-Advantage/AdvantageKit',
  }

  it('passes a listing a reader would get something out of', () => {
    expect(missingForPublish(good)).toEqual([])
  })

  it('holds a listing with no summary at all', () => {
    expect(missingForPublish({ ...good, summary: null })).toEqual(['summary'])
    expect(missingForPublish({ ...good, summary: '   ' })).toEqual(['summary'])
  })

  it('rejects the placeholder name the pipeline falls back to', () => {
    // publish.ts defaults a nameless candidate to "Untitled Tool", which must
    // never reach the directory as a real listing.
    expect(missingForPublish({ ...good, name: 'Untitled Tool' })).toEqual(['name'])
    expect(missingForPublish({ ...good, name: 'untitled tool' })).toEqual(['name'])
  })

  it('holds a listing with nowhere to send the reader', () => {
    expect(missingForPublish({ ...good, url: null })).toEqual(['link'])
  })

  it('reports every missing field at once, so one review fixes the lot', () => {
    expect(missingForPublish({ name: '', summary: '', url: '' })).toEqual(['name', 'summary', 'link'])
  })

  it('does not count whitespace as a summary', () => {
    expect(missingForPublish({ ...good, summary: '\n\t  \n' })).toEqual(['summary'])
  })
})
