import { describe, it, expect } from 'bun:test'
import { normalizeTitle, productTitle } from '../src/pipeline/extract.js'

describe('productTitle', () => {
  it('names a homepage by its site name when the title is a tagline', () => {
    const t = normalizeTitle('Multi-Format CAD Viewer &amp; Online Measurement Tools | CADProps', 'CADProps')
    expect(productTitle(t, 'CADProps', 'https://www.cadprops.com/')).toBe('CADProps')
  })
  it('keeps the title on a deeper page, a short title, or one that already names the product', () => {
    expect(productTitle('Measuring STEP files in the browser', 'CADProps', 'https://www.cadprops.com/docs/measure')).toBe('Measuring STEP files in the browser')
    expect(productTitle('AdvantageScope', 'Littleton Robotics', 'https://example.org/')).toBe('AdvantageScope')
    expect(productTitle('CADProps CAD Viewer', 'CADProps', 'https://www.cadprops.com/')).toBe('CADProps CAD Viewer')
    expect(productTitle('Online CAD viewer for teams', undefined, 'https://x.org/')).toBe('Online CAD viewer for teams')
  })
})
