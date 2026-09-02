/**
 * The event's own name, out of a thread title.
 *
 * Every case here is a real title from the queue.
 */
import { describe, it, expect } from 'bun:test'
import { cleanEventName } from '@the-tool-pit/db/event-name'

describe('cleanEventName', () => {
  it.each([
    ['2026 SoCal Showdown Offseason Competition', 'SoCal Showdown'],
    ['NYC Robo Replay 2026 - two day offseason 10/10-11', 'NYC Robo Replay'],
    ['CORI 2026 Registration Is Now Open! - Central Ohio Offseason Event', 'CORI'],
    ['Bordie Blast 2026 - Bordie Through Time', 'Bordie Blast'],
    ['The 2026 Red Stick Rumble', 'Red Stick Rumble'],
    ['Beach Blitz 2026', 'Beach Blitz'],
    ['2026 Midsummer Mayhem | August 8-9, 2026 | Rochester, NY', 'Midsummer Mayhem'],
  ])('%s -> %s', (raw, expected) => {
    expect(cleanEventName(raw)).toBe(expected)
  })

  it.each([
    // Real names that a cleverer rule would eat.
    ['Clash in The Corn', 'Clash in The Corn'],
    ['Where Is Wolcott Invitational', 'Where Is Wolcott Invitational'],
    ['Mos Eisley Invitational', 'Mos Eisley Invitational'],
    ['Chezy Champs', 'Chezy Champs'],
    ['Monster Match', 'Monster Match'],
  ])('leaves %s alone', (raw, expected) => {
    expect(cleanEventName(raw)).toBe(expected)
  })

  it('never returns nothing', () => {
    // A title that is only a year and a generic word would otherwise clean
    // itself away, and a listing has a NOT NULL name.
    expect(cleanEventName('2026 Offseason Event')).toBeTruthy()
    expect(cleanEventName('   ')).toBe('')
  })
})
