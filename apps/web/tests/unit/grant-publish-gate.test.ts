import { describe, expect, it } from 'vitest'
import { normalizeGrantName, seasonYear, staleSeasonInName } from '@/lib/admin/grant-publish'

const sept2026 = new Date('2026-09-08T12:00:00Z')
const march2026 = new Date('2026-03-08T12:00:00Z')

describe('seasonYear', () => {
  it('names the season by kickoff year', () => {
    expect(seasonYear(sept2026)).toBe(2027)
    expect(seasonYear(march2026)).toBe(2026)
  })
})

describe('staleSeasonInName', () => {
  it('flags last season, a past fiscal year and a past calendar year', () => {
    expect(staleSeasonInName('2024-2025 K-12 Robotics Competition Grant', sept2026)).toMatch(/2024-2025 season/)
    expect(staleSeasonInName('2025-2026 FRC Sponsorship Grants', sept2026)).toMatch(/season, which has ended/)
    expect(staleSeasonInName('Maryland Robotics Grant Program FY 2026', sept2026)).toMatch(/fiscal year 2026/)
    expect(staleSeasonInName('2022-2023 STEM Mini-Grants', sept2026)).not.toBeNull()
    expect(staleSeasonInName('2025 Community Grants', sept2026)).toMatch(/2025, which has passed/)
  })
  it('leaves the current season, fiscal year and year alone', () => {
    expect(staleSeasonInName('2026-2027 PTC FIRST Grant', sept2026)).toBeNull()
    expect(staleSeasonInName('Maryland Robotics Grant FY 2027', sept2026)).toBeNull()
    expect(staleSeasonInName('2026 Community Building Program', sept2026)).toBeNull()
    expect(staleSeasonInName('2025-2026 FTC Team Grant', march2026)).toBeNull()
    expect(staleSeasonInName('Maryland Robotics Grant FY 2026', march2026)).toBeNull()
  })
  it('ignores names with no year', () => {
    expect(staleSeasonInName('one by one Grant', sept2026)).toBeNull()
    expect(staleSeasonInName('GEAR UP Partnership (84.334A)', sept2026)).toBeNull()
  })
})

describe('normalizeGrantName', () => {
  it('matches the same programme across years and wording', () => {
    expect(normalizeGrantName('Maryland Robotics Grant Program FY 2026')).toBe(normalizeGrantName('Maryland Robotics Grant FY 2027'))
    expect(normalizeGrantName('2024-2025 K-12 Robotics Competition Grant')).toBe(normalizeGrantName('K-12 Robotics Competition Grant'))
    expect(normalizeGrantName('BAE Systems FIRST Team Grant')).not.toBe(normalizeGrantName('BAE Systems Scholarship'))
  })
})
