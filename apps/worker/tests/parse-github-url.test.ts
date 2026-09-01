import { describe, it, expect } from 'vitest'
import { parseGitHubUrl } from '../src/connectors/github.js'

/**
 * The popularity pass logged "not a GitHub repo URL" for
 * https://www.github.com/dkogan/mrcal and skipped a real listing over the
 * prefix. www.github.com is github.com, and it is the shape a person pastes.
 */
describe('parseGitHubUrl', () => {
  it('reads a plain repo url', () => {
    expect(parseGitHubUrl('https://github.com/wpilibsuite/allwpilib')).toEqual({
      owner: 'wpilibsuite',
      repo: 'allwpilib',
    })
  })

  it('accepts a www prefix', () => {
    expect(parseGitHubUrl('https://www.github.com/dkogan/mrcal')).toEqual({
      owner: 'dkogan',
      repo: 'mrcal',
    })
  })

  it('strips a .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/lasarobotics/PurplePath.git')).toEqual({
      owner: 'lasarobotics',
      repo: 'PurplePath',
    })
  })

  it('reads the repo out of a deep link', () => {
    expect(parseGitHubUrl('https://github.com/Mechanical-Advantage/AdvantageScope/releases/latest')).toEqual({
      owner: 'Mechanical-Advantage',
      repo: 'AdvantageScope',
    })
  })

  it('refuses a profile, which has no repo', () => {
    expect(parseGitHubUrl('https://github.com/wpilibsuite')).toBeNull()
  })

  it('refuses another host that merely mentions github', () => {
    expect(parseGitHubUrl('https://notgithub.com/a/b')).toBeNull()
  })

  it('refuses something that is not a url', () => {
    expect(parseGitHubUrl('wpilibsuite/allwpilib')).toBeNull()
  })
})
