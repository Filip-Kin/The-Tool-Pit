import { describe, expect, it } from 'vitest'
import { githubRepoIdentity, siteIdentity } from '@the-tool-pit/db/tool-identity'

describe('githubRepoIdentity', () => {
  it('collapses a rename and casing/hyphen change to one identity', () => {
    const a = githubRepoIdentity('https://github.com/CoreControlLib/CoreControlQuickstart')
    const b = githubRepoIdentity('https://github.com/CoreControlLib/corecontrol-quickstart')
    expect(a).toBe('corecontrollib/corecontrolquickstart')
    expect(a).toBe(b)
  })
  it('handles www, .git and trailing paths', () => {
    expect(githubRepoIdentity('https://www.github.com/Team/Repo.git/tree/main')).toBe('team/repo')
  })
  it('is null for non-github', () => {
    expect(githubRepoIdentity('https://frcbom.com/')).toBeNull()
  })
  it('keeps different repos apart', () => {
    expect(githubRepoIdentity('https://github.com/a/one')).not.toBe(githubRepoIdentity('https://github.com/a/two'))
  })
})

describe('siteIdentity', () => {
  it('reduces a subdomain to the registrable domain', () => {
    expect(siteIdentity('https://docs.frcbom.com/')).toBe('frcbom.com')
    expect(siteIdentity('https://frcbom.com/')).toBe('frcbom.com')
    expect(siteIdentity('https://www.frcbom.com/x')).toBe('frcbom.com')
  })
  it('is null for shared hosts and github', () => {
    expect(siteIdentity('https://myteam.github.io/tool')).toBeNull()
    expect(siteIdentity('https://foo.vercel.app/')).toBeNull()
    expect(siteIdentity('https://github.com/a/b')).toBeNull()
  })
  it('handles a multi-label TLD', () => {
    expect(siteIdentity('https://docs.example.co.uk/')).toBe('example.co.uk')
  })
})
