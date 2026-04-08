import { describe, it, expect } from 'vitest'
import { buildSlug } from '../src/pipeline/publish.js'

describe('buildSlug', () => {
  it('lowercases and hyphenates a basic title', () => {
    expect(buildSlug('My Cool Tool')).toBe('my-cool-tool')
  })

  it('strips special characters', () => {
    expect(buildSlug('FRC Scouting App!')).toBe('frc-scouting-app')
  })

  it('strips parentheses and brackets', () => {
    expect(buildSlug('TBA (The Blue Alliance)')).toBe('tba-the-blue-alliance')
  })

  it('collapses multiple spaces into a single hyphen', () => {
    expect(buildSlug('Tool   with   spaces')).toBe('tool-with-spaces')
  })

  it('collapses multiple hyphens', () => {
    expect(buildSlug('tool--double--hyphen')).toBe('tool-double-hyphen')
  })

  it('trims leading and trailing hyphens', () => {
    expect(buildSlug('--leading and trailing--')).toBe('leading-and-trailing')
  })

  it('truncates at 80 characters', () => {
    const long = 'a'.repeat(100)
    expect(buildSlug(long).length).toBeLessThanOrEqual(80)
  })

  it('handles all-special-char input gracefully', () => {
    const result = buildSlug('!!!')
    expect(result).toBe('')
  })

  it('preserves hyphens that are already in the title', () => {
    expect(buildSlug('blue-alliance')).toBe('blue-alliance')
  })

  it('handles numbers', () => {
    expect(buildSlug('FRC 2024 Scouter')).toBe('frc-2024-scouter')
  })
})
