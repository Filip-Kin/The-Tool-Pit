import { describe, it, expect } from 'bun:test'
import { listingFields } from '../src/jobs/new-listings-report.js'

describe('listingFields', () => {
  it('links each title and stays under the Discord field cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ title: `Grant number ${i} with a longish name [x]`, url: `https://frc.tools/grants/g-${i}` }))
    const fields = listingFields(many)
    expect(fields[0].label).toBe('Listings')
    for (const f of fields) expect(f.value.length).toBeLessThanOrEqual(1024)
    const text = fields.map((f) => f.value).join('\n')
    expect(text).toContain('[Grant number 0 with a longish name x](https://frc.tools/grants/g-0)')
    expect(text).toContain('+20 more')
  })
})
