import { describe, it, expect } from 'bun:test'
import { streetLine } from '@the-tool-pit/db/country'

// 2026-10-04: 26 published events stored the whole postal address in
// `address`, so their pages printed the city and state twice.
describe('streetLine', () => {
  it.each([
    ['501 Minnesota Ave E, Big Lake, MN 55309', 'Big Lake', 'MN', '501 Minnesota Ave E'],
    ['24787 Van Horn Rd, Brownstown Charter Twp, MI 48134', 'Brownstown Charter Twp', 'MI', '24787 Van Horn Rd'],
    ['200 Whitney Ave, Hamilton, ON L8S 2G7', 'Hamilton', 'ON', '200 Whitney Ave'],
    ['Barker College, 9 The Avenue, Hornsby NSW 2077, Australia', 'Hornsby', 'NSW', '9 The Avenue'],
    ['Bethpage High School\n10 Cherry Ave\nBethpage, NY, USA', 'Bethpage', 'NY', '10 Cherry Ave'],
    ['100 Main St, Building B, Novi, MI', 'Novi', 'MI', '100 Main St, Building B'],
  ])('cuts %p to the street', (address, city, region, want) => {
    expect(streetLine(address, { city, region })).toBe(want)
  })

  it.each([
    ['3319 Millwood Avenue', 'Columbia', 'SC'],
    ['100 Main St, Suite 4', 'Novi', 'MI'],
    ['33.038538, -117.274736', 'Encinitas', 'CA'],
  ])('leaves %p alone', (address, city, region) => {
    expect(streetLine(address, { city, region })).toBe(address)
  })

  it('is null for blank', () => {
    expect(streetLine('  ', {})).toBeNull()
    expect(streetLine(null, {})).toBeNull()
  })
})
