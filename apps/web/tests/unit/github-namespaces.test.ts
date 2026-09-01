import { describe, it, expect } from 'vitest'
import {
  buildNamespaceSet,
  githubOwnerFromUrl,
  matchNamespace,
  planGithubGrants,
  type OwnershipSnapshot,
} from '@/lib/github/namespaces'
import { describeGithubGrant } from '@/lib/github/summary'

/**
 * The matcher decides who gets write access to somebody else's listing, so the
 * cases below are the ones that would hurt if they were wrong: a near-miss team
 * number, a profile link mistaken for a repo, and a listing that already has an
 * owner.
 */

const NOBODY_OWNS: OwnershipSnapshot = { yours: new Set(), anyone: new Set() }

describe('githubOwnerFromUrl', () => {
  it('reads the owner from a repository URL', () => {
    expect(githubOwnerFromUrl('https://github.com/frc206/robot-2026')).toBe('frc206')
  })

  it('lowercases the owner, because GitHub logins are case-insensitive', () => {
    expect(githubOwnerFromUrl('https://github.com/Team254/FRC-2024')).toBe('team254')
  })

  it('reads through a deep link into the repository', () => {
    expect(githubOwnerFromUrl('https://github.com/frc206/robot-2026/tree/main/src')).toBe('frc206')
  })

  it('drops a trailing .git', () => {
    expect(githubOwnerFromUrl('https://github.com/frc206/robot-2026.git')).toBe('frc206')
  })

  it('accepts www.github.com', () => {
    expect(githubOwnerFromUrl('https://www.github.com/frc206/robot-2026')).toBe('frc206')
  })

  it('refuses a profile page, which is not a repository', () => {
    expect(githubOwnerFromUrl('https://github.com/frc206')).toBeNull()
    expect(githubOwnerFromUrl('https://github.com/frc206/')).toBeNull()
  })

  it('refuses a reserved GitHub path', () => {
    expect(githubOwnerFromUrl('https://github.com/orgs/frc206/repositories')).toBeNull()
    expect(githubOwnerFromUrl('https://github.com/topics/frc')).toBeNull()
  })

  it('refuses a host that is not github.com', () => {
    expect(githubOwnerFromUrl('https://gitlab.com/frc206/robot-2026')).toBeNull()
    expect(githubOwnerFromUrl('https://gist.github.com/frc206/abc123')).toBeNull()
    expect(githubOwnerFromUrl('https://github.com.evil.example/frc206/robot')).toBeNull()
  })

  it('refuses rubbish', () => {
    expect(githubOwnerFromUrl('not a url')).toBeNull()
    expect(githubOwnerFromUrl('')).toBeNull()
  })
})

describe('buildNamespaceSet', () => {
  it('holds the login and every org, lowercased', () => {
    const set = buildNamespaceSet('FilipKin', ['Team206', 'wpilibsuite'])
    expect([...set].sort()).toEqual(['filipkin', 'team206', 'wpilibsuite'])
  })

  it('ignores blank entries', () => {
    const set = buildNamespaceSet('filipkin', ['', '   '])
    expect([...set]).toEqual(['filipkin'])
  })
})

describe('matchNamespace', () => {
  const namespaces = buildNamespaceSet('filipkin', ['frc206'])

  it('matches the user own namespace', () => {
    expect(matchNamespace(namespaces, 'https://github.com/filipkin/some-tool')).toBe('filipkin')
  })

  it('matches an organisation the user belongs to', () => {
    expect(matchNamespace(namespaces, 'https://github.com/frc206/robot-2026')).toBe('frc206')
  })

  it('matches whatever the case in the URL', () => {
    expect(matchNamespace(namespaces, 'https://github.com/FRC206/Robot-2026')).toBe('frc206')
  })

  it('does not match a namespace that merely starts the same', () => {
    // frc206 and frc2062 are two different teams. A substring compare here
    // would hand one team the other team's listings.
    expect(matchNamespace(namespaces, 'https://github.com/frc2062/robot-2026')).toBeNull()
    expect(matchNamespace(buildNamespaceSet('frc2062', []), 'https://github.com/frc206/x')).toBeNull()
  })

  it('does not match a URL that is not a repository', () => {
    expect(matchNamespace(namespaces, 'https://github.com/frc206')).toBeNull()
  })
})

describe('planGithubGrants', () => {
  const namespaces = buildNamespaceSet('filipkin', ['frc206'])

  it('grants an unowned listing in a matched namespace', () => {
    const plan = planGithubGrants(
      [{ entityId: 'tool-a', url: 'https://github.com/frc206/robot-2026' }],
      namespaces,
      NOBODY_OWNS,
    )
    expect(plan).toEqual([
      { entityId: 'tool-a', namespace: 'frc206', url: 'https://github.com/frc206/robot-2026', outcome: 'grant' },
    ])
  })

  it('leaves a listing somebody else owns alone, as a dispute', () => {
    const plan = planGithubGrants(
      [{ entityId: 'tool-a', url: 'https://github.com/frc206/robot-2026' }],
      namespaces,
      { yours: new Set(), anyone: new Set(['tool-a']) },
    )
    expect(plan.map((m) => m.outcome)).toEqual(['dispute'])
  })

  it('reports a listing the user already owns as held, so a re-check writes nothing', () => {
    const plan = planGithubGrants(
      [{ entityId: 'tool-a', url: 'https://github.com/frc206/robot-2026' }],
      namespaces,
      { yours: new Set(['tool-a']), anyone: new Set(['tool-a']) },
    )
    expect(plan.map((m) => m.outcome)).toEqual(['held'])
  })

  it('skips listings in namespaces the user does not belong to', () => {
    const plan = planGithubGrants(
      [
        { entityId: 'tool-a', url: 'https://github.com/frc2062/robot-2026' },
        { entityId: 'tool-b', url: 'https://github.com/wpilibsuite/allwpilib' },
        { entityId: 'tool-c', url: 'https://example.com/whatever' },
      ],
      namespaces,
      NOBODY_OWNS,
    )
    expect(plan).toEqual([])
  })

  it('counts a listing once when several of its links match', () => {
    const plan = planGithubGrants(
      [
        { entityId: 'tool-a', url: 'https://github.com/filipkin/robot-2026' },
        { entityId: 'tool-a', url: 'https://github.com/frc206/robot-2026' },
      ],
      namespaces,
      NOBODY_OWNS,
    )
    expect(plan).toHaveLength(1)
    expect(plan[0].namespace).toBe('filipkin')
  })

  it('still matches a listing whose first link is not a repo', () => {
    const plan = planGithubGrants(
      [
        { entityId: 'tool-a', url: 'https://frc206.org' },
        { entityId: 'tool-a', url: 'https://github.com/frc206/robot-2026' },
      ],
      namespaces,
      NOBODY_OWNS,
    )
    expect(plan.map((m) => m.entityId)).toEqual(['tool-a'])
  })

  it('is idempotent: the same input twice gives the same plan', () => {
    const links = [{ entityId: 'tool-a', url: 'https://github.com/frc206/robot-2026' }]
    expect(planGithubGrants(links, namespaces, NOBODY_OWNS)).toEqual(
      planGithubGrants(links, namespaces, NOBODY_OWNS),
    )
  })
})

describe('describeGithubGrant', () => {
  const base = { login: 'filipkin', granted: [], disputed: [], alreadyYours: 0, sawPrivateOrgs: true }
  const listing = (id: string) => ({ entityId: id, title: id, href: `/tools/${id}` })

  it('counts what the user got', () => {
    expect(describeGithubGrant({ ...base, granted: [listing('a'), listing('b')] })).toBe(
      'You now manage 2 listings.',
    )
  })

  it('says one listing in the singular', () => {
    expect(describeGithubGrant({ ...base, granted: [listing('a')] })).toBe('You now manage 1 listing.')
  })

  it('says nothing granted plainly, without implying a failure', () => {
    const msg = describeGithubGrant(base)
    expect(msg).toContain('Linked as filipkin')
    expect(msg).toContain('nothing changed')
  })

  it('tells a re-check that found nothing new that everything is already theirs', () => {
    expect(describeGithubGrant({ ...base, alreadyYours: 3 })).toBe(
      'No new listings this time. You already manage everything we matched.',
    )
  })

  it('mentions listings held for review', () => {
    const msg = describeGithubGrant({ ...base, granted: [listing('a')], disputed: [listing('b')] })
    expect(msg).toContain('1 listing matched but already had an owner')
  })

  it('explains a missing organisation scope rather than showing a short list silently', () => {
    expect(describeGithubGrant({ ...base, sawPrivateOrgs: false })).toContain('public organisations')
  })
})
