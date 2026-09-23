import { describe, it, expect } from 'vitest'
import { decideNameMatch, eventNameTokens, isFllOnlyTitle } from '../src/jobs/album-match.js'

const ev = (name: string, code = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 6)) => ({ name, code })

/** A plausible FRC year of event names, shared by the cases below. */
const FRC_2025 = [
  ev('Seven Rivers Regional', 'wila'),
  ev('Wisconsin Regional presented by GE HealthCare', 'wimi'),
  ev('Mukwonago Robotics Offseason Competition', 'wimuk'),
  ev('TWIST', 'twist'),
  ev('FIM District Troy Event', 'mitry'),
  ev('FIT District Manor Event', 'txman'),
  ev('Einstein Field', 'cmptx'),
  ev('Michigan State Championship-NW', 'micmpnw'),
  ev('Michigan State Championship-SE', 'micmpse'),
  ev('Lake Superior Regional', 'mndu'),
]

describe('eventNameTokens', () => {
  it('drops boilerplate, sponsor tail and district prefix', () => {
    expect(eventNameTokens('WIN District Seven Rivers Event presented by Mathy Construction Company')).toEqual([
      'seven',
      'rivers',
    ])
    expect(eventNameTokens('FIM District Troy Event')).toEqual(['troy'])
    expect(eventNameTokens('Wisconsin Regional presented by GE HealthCare')).toEqual(['wisconsin'])
    expect(eventNameTokens('Mukwonago Robotics Offseason Competition')).toEqual(['mukwonago'])
    expect(eventNameTokens('Einstein Field')).toEqual(['einstein', 'field'])
  })
})

describe('decideNameMatch', () => {
  it('matches a title that names the event', () => {
    const d = decideNameMatch('2023 FRC Muskego TWIST Greg Blau - FIRST Wisconsin', FRC_2025)
    expect(d.match?.event.code).toBe('twist')
    expect(d.match?.score).toBe(1)
  })

  it('does not let a " - FIRST Wisconsin" site suffix vote for Wisconsin Regional', () => {
    const d = decideNameMatch('2025 FRC Seven Rivers Regional Committee Pics Greg Blau - FIRST Wisconsin', FRC_2025)
    expect(d.match?.event.code).toBe('wila')
  })

  it('matches a district title that pg_trgm scored below 0.6', () => {
    expect(decideNameMatch('2024 Troy District Greg', FRC_2025).match?.event.code).toBe('mitry')
  })

  it('matches the long sponsored district name and "La Crosse" spelled either way', () => {
    const pool = [
      ev('WIN District Seven Rivers Event presented by Mathy Construction Company', 'wisr'),
      ev('WIN District La Crosse Event', 'wilac'),
      ev('Wisconsin Regional presented by GE HealthCare', 'wimi'),
    ]
    expect(decideNameMatch('2026 FRC La Crosse District Event', pool).match?.event.code).toBe('wilac')
    expect(decideNameMatch('2026 LaCrosse', pool).match?.event.code).toBe('wilac')
    expect(decideNameMatch('2026 Seven Rivers Greg Blau', pool).match?.event.code).toBe('wisr')
  })

  it('does not match "twist" inside another word', () => {
    const d = decideNameMatch('2025 Twisted Metal Build Day', FRC_2025)
    expect(d.match).toBeNull()
  })

  it('leaves a tie between near-identical names for AI/admin, with a guess', () => {
    const d = decideNameMatch('2025 Michigan State Championship', FRC_2025)
    expect(d.match).toBeNull()
    expect(d.maybe).toBe(true)
    expect(['micmpnw', 'micmpse']).toContain(d.ranked[0].event.code)
  })

  it('never auto-matches among identically named events', () => {
    const ftc = [
      ev('Wisconsin Championship', 'wicmp1'),
      ev('Wisconsin Championship', 'wicmp2'),
      ev('Wisconsin Championship', 'wicmp3'),
      ev('Wisconsin Championship', 'wicmp4'),
    ]
    const d = decideNameMatch('2025 FTC Wisconsin Championship', ftc)
    expect(d.match).toBeNull()
    expect(d.maybe).toBe(true)
  })

  it('reports nothing plausible for an unrelated title', () => {
    const d = decideNameMatch('2025 Team 1234 Build Season', FRC_2025)
    expect(d.match).toBeNull()
    expect(d.maybe).toBe(false)
  })

  it('matches Einstein Field from the division word', () => {
    expect(decideNameMatch('2024 Houston Einstein', FRC_2025).match?.event.code).toBe('cmptx')
  })
})

describe('isFllOnlyTitle', () => {
  it('flags FLL-only titles', () => {
    expect(isFllOnlyTitle('2025 FLL Wisconsin State')).toBe(true)
    expect(isFllOnlyTitle('FIRST LEGO League Challenge Qualifier 2024')).toBe(true)
  })
  it('keeps combined FLL+FTC events and plain FRC/FTC titles', () => {
    expect(isFllOnlyTitle('FLL-FTC2026 - Prix')).toBe(false)
    expect(isFllOnlyTitle('2025 FLL and FRC Demo Day')).toBe(false)
    expect(isFllOnlyTitle('2025 FRC Seven Rivers Regional')).toBe(false)
  })
})
