import { describe, expect, it } from 'vitest'
import { inferRegions } from '../src/grants/infer-regions.js'

describe('inferRegions', () => {
  it('takes the state the funder and page keep naming', () => {
    const g = inferRegions(['Maryland State Department of Education', 'Maryland Robotics Grant supports Maryland public schools. Contact the Maryland office.'], 'US')
    expect(g?.codes).toEqual(['MD'])
  })
  it('does not read Virginia out of West Virginia', () => {
    const g = inferRegions(['Eastern West Virginia Community Foundation', 'serving West Virginia counties'], 'US')
    expect(g?.codes).toEqual(['WV'])
  })
  it('refuses an even multi-state page', () => {
    expect(inferRegions(['Serving Ohio, Indiana and Michigan teams. Ohio Indiana Michigan.'], 'US')).toBeNull()
  })
  it('refuses a single passing mention', () => {
    expect(inferRegions(['Headquartered in Texas.'], 'US')).toBeNull()
  })
  it('uses provinces for Canada', () => {
    expect(inferRegions(['Ontario Trillium Foundation funds Ontario nonprofits'], 'CA')?.codes).toEqual(['ON'])
  })
})
