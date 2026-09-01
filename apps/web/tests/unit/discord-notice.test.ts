import { describe, it, expect } from 'vitest'
import {
  APPROVAL_WEBHOOK_ENV,
  buildApprovalEmbed,
  reviewAlbumUrl,
  reviewClaimUrl,
  reviewFieldUrl,
  postApprovalNotice,
  type ApprovalNotice,
} from '@the-tool-pit/types'

/**
 * The one Discord notifier, checked where it can actually go wrong.
 *
 * None of this posts anything. The builder is pure on purpose, so what a
 * moderator will see can be asserted without a webhook, and the one test that
 * does call postApprovalNotice does it with the environment variable unset,
 * which is the branch that returns 'skipped' without a request.
 *
 * What these are really guarding is the failure that started all this: a dead
 * webhook that returned an error nobody ever saw. So: the link must point at
 * the ROW, a missing webhook must be loud rather than silent, and nothing here
 * may throw, because every call site fires without awaiting.
 */

const NOTICE: ApprovalNotice = {
  vertical: 'album',
  title: 'FIM District Midland Event 2026',
  reviewUrl: reviewAlbumUrl('cand-1'),
  sourceUrl: 'https://photos.app.goo.gl/abc123',
  submitter: 'Filip Kin',
  facts: [
    { label: 'Event code', value: 'mimid', inline: true },
    { label: 'Year', value: 2026, inline: true },
    { label: 'Nothing', value: '   ' },
    { label: 'Missing', value: null },
  ],
}

describe('the embed', () => {
  it('names the vertical in the title, so the queue is obvious', () => {
    expect(buildApprovalEmbed(NOTICE).title).toBe(
      'Photo album submission: FIM District Midland Event 2026',
    )
  })

  it('links the title at the approval row, not at a dashboard', () => {
    const embed = buildApprovalEmbed(NOTICE)
    expect(embed.url).toContain('/admin/album-candidates')
    expect(embed.url).toContain('#album-cand-1')
    // The description repeats it, because a phone taps the heading and a
    // desktop reads the sentence.
    expect(embed.description).toContain(embed.url as string)
  })

  it('drops blank and missing facts, which Discord rejects outright', () => {
    const names = buildApprovalEmbed(NOTICE).fields.map((f) => f.name)
    expect(names).toContain('Event code')
    expect(names).not.toContain('Nothing')
    expect(names).not.toContain('Missing')
  })

  it('turns a number into a string, because a fact value has to be text', () => {
    const year = buildApprovalEmbed(NOTICE).fields.find((f) => f.name === 'Year')
    expect(year?.value).toBe('2026')
  })

  it('says the submitter was anonymous rather than leaving the row out', () => {
    // A missing row reads as a bug in the notifier. "Anonymous" reads as the
    // fact it is: signing in is optional on every public form here.
    const embed = buildApprovalEmbed({ ...NOTICE, submitter: null })
    const row = embed.fields.find((f) => f.name === 'Submitted by')
    expect(row?.value).toBe('Anonymous (no account)')
  })

  it('asks a crawl run no question it cannot answer', () => {
    const embed = buildApprovalEmbed({
      vertical: 'crawl',
      title: 'github_topics found 12 new tools',
      reviewUrl: 'https://frc.tools/admin/candidates?status=pending',
      facts: [{ label: 'New', value: 12, inline: true }],
    })
    expect(embed.fields.map((f) => f.name)).not.toContain('Submitted by')
  })

  it('gives every vertical its own colour, so the queue reads off the stripe', () => {
    const colours = (['album', 'field', 'grant', 'claim', 'crawl'] as const).map(
      (vertical) => buildApprovalEmbed({ ...NOTICE, vertical }).color,
    )
    expect(new Set(colours).size).toBe(colours.length)
  })

  it('cuts a long value instead of dropping the whole field', () => {
    const embed = buildApprovalEmbed({
      ...NOTICE,
      facts: [{ label: 'Note', value: 'x'.repeat(5000) }],
    })
    const note = embed.fields.find((f) => f.name === 'Note')
    expect(note?.value.length).toBe(1024)
  })
})

describe('posting', () => {
  it('says so out loud when the webhook is not configured', async () => {
    // The whole point of the rewrite. A missing or dead webhook used to be
    // swallowed by an empty catch behind `void`, so notifications stopped and
    // nobody found out until somebody asked why their album was ignored.
    const before = process.env[APPROVAL_WEBHOOK_ENV]
    delete process.env[APPROVAL_WEBHOOK_ENV]
    const warnings: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '))
    try {
      await expect(postApprovalNotice(NOTICE)).resolves.toBe('skipped')
      expect(warnings.join('\n')).toContain(APPROVAL_WEBHOOK_ENV)
    } finally {
      console.warn = realWarn
      if (before !== undefined) process.env[APPROVAL_WEBHOOK_ENV] = before
    }
  })
})

describe('review links', () => {
  it('anchors each one on the row id the admin page renders', () => {
    expect(reviewFieldUrl('f1')).toContain('#field-f1')
    expect(reviewClaimUrl('c1')).toContain('#claim-c1')
  })

  it('never builds a localhost link, whatever the environment holds', () => {
    // A link to localhost in a moderator's Discord is worse than a link to a
    // page they have to find themselves.
    expect(reviewFieldUrl('f1')).toMatch(/^https:\/\//)
    expect(reviewFieldUrl('f1')).not.toContain('localhost')
  })
})
