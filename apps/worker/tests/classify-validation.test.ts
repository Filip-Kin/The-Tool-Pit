import { describe, it, expect } from 'vitest'
import { validateClassificationOutput } from '../src/pipeline/classify.js'

describe('validateClassificationOutput', () => {
  describe('toolType', () => {
    it('preserves a valid toolType', () => {
      const result = validateClassificationOutput({ toolType: 'web_app' })
      expect(result.toolType).toBe('web_app')
    })

    it('falls back to "other" for an unknown toolType', () => {
      const result = validateClassificationOutput({ toolType: 'chatbot' as never })
      expect(result.toolType).toBe('other')
    })

    it('accepts all valid toolType values', () => {
      const valid = [
        'web_app', 'desktop_app', 'mobile_app', 'calculator', 'spreadsheet',
        'github_project', 'browser_extension', 'api', 'resource', 'other',
      ]
      for (const t of valid) {
        const result = validateClassificationOutput({ toolType: t as never })
        expect(result.toolType).toBe(t)
      }
    })
  })

  describe('programs', () => {
    it('preserves valid program values', () => {
      const result = validateClassificationOutput({ programs: ['frc', 'ftc'] })
      expect(result.programs).toEqual(['frc', 'ftc'])
    })

    it('filters out invalid program values', () => {
      const result = validateClassificationOutput({ programs: ['frc', 'vex', 'ftc'] as never })
      expect(result.programs).toEqual(['frc', 'ftc'])
    })

    it('returns empty array when all programs are invalid', () => {
      const result = validateClassificationOutput({ programs: ['vex', 'botball'] as never })
      expect(result.programs).toEqual([])
    })
  })

  describe('audienceRoles', () => {
    it('preserves valid audience roles', () => {
      const result = validateClassificationOutput({ audienceRoles: ['student', 'mentor'] })
      expect(result.audienceRoles).toEqual(['student', 'mentor'])
    })

    it('filters out unknown roles', () => {
      const result = validateClassificationOutput({ audienceRoles: ['student', 'coach'] as never })
      expect(result.audienceRoles).toEqual(['student'])
    })
  })

  describe('audienceFunctions', () => {
    it('preserves valid functions', () => {
      const result = validateClassificationOutput({ audienceFunctions: ['programmer', 'scouter'] })
      expect(result.audienceFunctions).toEqual(['programmer', 'scouter'])
    })

    it('filters out unknown functions', () => {
      const result = validateClassificationOutput({ audienceFunctions: ['programmer', 'driver'] as never })
      expect(result.audienceFunctions).toEqual(['programmer'])
    })
  })

  describe('isTeamCode + teamNumber', () => {
    it('preserves valid teamNumber when isTeamCode=true', () => {
      const result = validateClassificationOutput({ isTeamCode: true, teamNumber: 254 })
      expect(result.teamNumber).toBe(254)
    })

    it('nulls out teamNumber < 1 when isTeamCode=true', () => {
      const result = validateClassificationOutput({ isTeamCode: true, teamNumber: 0 })
      expect(result.teamNumber).toBeNull()
    })

    it('nulls out teamNumber > 99999 when isTeamCode=true', () => {
      const result = validateClassificationOutput({ isTeamCode: true, teamNumber: 100000 })
      expect(result.teamNumber).toBeNull()
    })

    it('nulls out non-integer teamNumber when isTeamCode=true', () => {
      const result = validateClassificationOutput({ isTeamCode: true, teamNumber: 254.5 })
      expect(result.teamNumber).toBeNull()
    })

    it('drops teamNumber when neither isTeamCode nor isTeamCad is set', () => {
      // A team number only means something on a team's own code or CAD. Carried on a
      // general tool it stamps the team into the name and slug and splits the listing
      // from its own earlier row, which is how a dupe slipped past name dedup.
      const result = validateClassificationOutput({ isTeamCode: false, teamNumber: 254 })
      if (result.teamNumber !== null) {
        throw new Error(`non-team tool kept teamNumber ${result.teamNumber}; expected null`)
      }
      expect(result.teamNumber).toBeNull()
    })

    it('preserves null teamNumber as-is', () => {
      const result = validateClassificationOutput({ isTeamCode: true, teamNumber: null })
      expect(result.teamNumber).toBeNull()
    })
  })

  describe('isTeamCode + seasonYear', () => {
    it('preserves valid seasonYear', () => {
      const result = validateClassificationOutput({ isTeamCode: true, seasonYear: 2024 })
      expect(result.seasonYear).toBe(2024)
    })

    it('nulls out seasonYear < 2000 when isTeamCode=true', () => {
      const result = validateClassificationOutput({ isTeamCode: true, seasonYear: 1999 })
      expect(result.seasonYear).toBeNull()
    })

    it('drops seasonYear when neither isTeamCode nor isTeamCad is set', () => {
      // "FRC Cycle Times" must never become "FRC 2026 Cycle Times": a season on a
      // non-team tool poisons the name/slug and dodges name-similarity dedup.
      const result = validateClassificationOutput({ isTeamCode: false, seasonYear: 2026 })
      if (result.seasonYear !== null) {
        throw new Error(`non-team tool kept seasonYear ${result.seasonYear}; expected null`)
      }
      expect(result.seasonYear).toBeNull()
    })

    it('keeps seasonYear on a team CAD listing (isTeamCad=true)', () => {
      const result = validateClassificationOutput({ isTeamCad: true, seasonYear: 2024 })
      expect(result.seasonYear).toBe(2024)
    })
  })

  it('does not mutate the original object', () => {
    const input = { toolType: 'chatbot' as never, programs: ['vex'] as never }
    const copy = { ...input }
    validateClassificationOutput(input)
    expect(input).toEqual(copy)
  })
})
