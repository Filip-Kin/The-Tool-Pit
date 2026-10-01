/**
 * generateTeamListParser's give-up alert, with the browser and the model faked.
 *
 * The 3-day re-proof passes notifyOnGiveUp: false, because the stored parser
 * may still read the page (FIRST Chance, 2026-09-30). Every other caller keeps
 * the alert. The fakes delegate to the real modules unless this file switched
 * them on, so other test files in the same process are untouched.
 */
import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test'

const realTypes = await import('@the-tool-pit/types')
const realRender = await import('../src/connectors/playwright-render.js')
const realAnthropic = await import('../src/anthropic.js')

let faking = false
const notices: Array<{ title: string }> = []

// A page whose cleaned HTML is readable, and on which every parser finds nothing.
const fakePage = {
  frames: () => [
    {
      evaluate: async (expr: string) => {
        if (expr.includes('extractTeams')) return []
        if (expr.includes('createHTMLDocument')) return '<table><tr><td>Registered Teams</td></tr><tr><td>254</td></tr></table>'
        return []
      },
    },
  ],
}

mock.module('@the-tool-pit/types', () => ({
  ...realTypes,
  sendApprovalNotice: (notice: { title: string }, ...rest: unknown[]) => {
    if (faking) {
      notices.push(notice)
      return
    }
    return (realTypes.sendApprovalNotice as (...a: unknown[]) => void)(notice, ...rest)
  },
}))

mock.module('../src/connectors/playwright-render.js', () => ({
  ...realRender,
  withRenderedPage: async (url: string, fn: (page: unknown) => Promise<unknown>) =>
    faking ? fn(fakePage) : realRender.withRenderedPage(url, fn as never),
  settleDynamicContent: async (page: unknown) => (faking ? undefined : realRender.settleDynamicContent(page as never)),
}))

mock.module('../src/anthropic.js', () => ({
  ...realAnthropic,
  hasAnthropicCredentials: () => (faking ? true : realAnthropic.hasAnthropicCredentials()),
  anthropic: () =>
    faking
      ? {
          messages: {
            create: async () => ({
              content: [{ type: 'text', text: 'function extractTeams() { return [] }' }],
              stop_reason: 'end_turn',
            }),
          },
        }
      : realAnthropic.anthropic(),
}))

const { generateTeamListParser } = await import('../src/listings/team-list-parser.js')

describe('generateTeamListParser give-up alert', () => {
  beforeAll(() => {
    faking = true
  })
  afterAll(() => {
    faking = false
  })

  it('posts "Team list unreadable" by default', async () => {
    notices.length = 0
    const gen = await generateTeamListParser({ eventName: 'FIRST Chance', url: 'https://example.org/teams' })
    expect(gen).toBeNull()
    expect(notices.map((n) => n.title)).toEqual(['Team list unreadable: FIRST Chance'])
  })

  it('stays quiet when the caller says it will decide', async () => {
    notices.length = 0
    const gen = await generateTeamListParser({
      eventName: 'FIRST Chance',
      url: 'https://example.org/teams',
      notifyOnGiveUp: false,
    })
    expect(gen).toBeNull()
    expect(notices).toEqual([])
  })
})
