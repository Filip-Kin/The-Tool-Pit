import { describe, it, expect } from 'bun:test'
import { holdLabel } from '../src/site/moderate.js'

describe('holdLabel', () => {
  it('keeps the first clause of a pipeline reason', () => {
    expect(holdLabel('AI confidence too low (45%) — requires manual review')).toBe('AI confidence too low (45%)')
    expect(holdLabel('Duplicate of an existing published tool by resolved name "X"')).toBe('Duplicate of an existing published tool by resolved name "X"')
    expect(holdLabel(undefined)).toBeNull()
  })
})
