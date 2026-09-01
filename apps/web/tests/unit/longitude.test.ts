import { describe, it, expect } from 'vitest'
import { wrapLongitude, longitudeNearestTo } from '@/lib/geo/longitude'

/**
 * The map lets a visitor pan onto another copy of the world, and Leaflet then
 * reports longitudes from that copy. These two functions are the only thing
 * standing between that and a saved coordinate the server will silently throw
 * away, so the seams get checked one by one.
 */

describe('wrapLongitude', () => {
  it('leaves a real longitude exactly as it was', () => {
    for (const lng of [0, -83.1543377, 174.7633, -0.1276, 151.2093, 45.5]) {
      expect(wrapLongitude(lng)).toBe(lng)
    }
  })

  it('keeps both ends of the range', () => {
    expect(wrapLongitude(180)).toBe(180)
    expect(wrapLongitude(-180)).toBe(-180)
  })

  it('folds a pin dropped on the next copy of the world', () => {
    expect(wrapLongitude(205)).toBeCloseTo(-155, 10)
    expect(wrapLongitude(-205)).toBeCloseTo(155, 10)
    expect(wrapLongitude(181)).toBeCloseTo(-179, 10)
    expect(wrapLongitude(-181)).toBeCloseTo(179, 10)
  })

  it('folds a pin dropped several copies out, which is the reported bug', () => {
    expect(wrapLongitude(540)).toBe(180)
    expect(wrapLongitude(-540)).toBe(-180)
    expect(wrapLongitude(360)).toBeCloseTo(0, 10)
    expect(wrapLongitude(-720)).toBeCloseTo(0, 10)
    expect(wrapLongitude(1080 - 83.15)).toBeCloseTo(-83.15, 10)
  })

  it('always returns something the submit and edit handlers will accept', () => {
    for (let lng = -2000; lng <= 2000; lng += 7.3) {
      expect(Math.abs(wrapLongitude(lng))).toBeLessThanOrEqual(180)
    }
  })

  it('does not move the point it describes', () => {
    for (const lng of [540, -540, 205, -205, 1000, -1000, 359.9]) {
      const diff = lng - wrapLongitude(lng)
      expect(Math.abs(diff % 360)).toBeCloseTo(0, 8)
    }
  })
})

describe('longitudeNearestTo', () => {
  it('leaves a marker alone when the view is already looking at it', () => {
    expect(longitudeNearestTo(-83.15, -90)).toBe(-83.15)
    expect(longitudeNearestTo(174.76, 170)).toBe(174.76)
  })

  it('pulls a marker onto the copy of the world on screen', () => {
    expect(longitudeNearestTo(-155, 178)).toBeCloseTo(205, 10)
    expect(longitudeNearestTo(155, -178)).toBeCloseTo(-205, 10)
  })

  it('pushes it back once the view pans home again', () => {
    expect(longitudeNearestTo(205, -100)).toBeCloseTo(-155, 10)
  })

  it('lands within half a world of the view, whatever it is handed', () => {
    for (let lng = -1000; lng <= 1000; lng += 11.7) {
      const view = 42.5
      expect(Math.abs(longitudeNearestTo(lng, view) - view)).toBeLessThanOrEqual(180)
    }
  })

  it('keeps the real position, only the copy changes', () => {
    for (const [lng, view] of [[-155, 178], [155, -178], [20, 700]] as const) {
      const moved = longitudeNearestTo(lng, view)
      expect(Math.abs((moved - lng) % 360)).toBeCloseTo(0, 8)
      expect(wrapLongitude(moved)).toBeCloseTo(wrapLongitude(lng), 8)
    }
  })
})
