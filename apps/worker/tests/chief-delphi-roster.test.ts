/**
 * The Chief Delphi roster path, pinned against the real SCRIW XV thread
 * (topic 523187, saved from /t/523187.json on 2026-09-24).
 *
 * The thread is the case this path exists for: the organiser (Billfred) posts
 * the roster as a table in posts 1-6 and again in post 9, another user asks for
 * an update in post 7, post 8 is prose, and post 9 is current. Post 9 also
 * names teams in a sentence ("4083 ... let us move 11167 and 281 into the
 * field"), which must never be read as a roster.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  chiefDelphiTopicId,
  isChiefDelphiThread,
  fetchThreadPosts,
  pickRosterPost,
  readRosterFromPost,
  looksLikeRosterPost,
  parseEntryText,
  readChiefDelphiRoster,
  type ThreadPost,
} from '../src/listings/chief-delphi-roster.js'

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'chief-delphi-scriw-523187.json'), 'utf8'),
) as { id: number; details: { created_by: { username: string } }; post_stream: { stream: number[]; posts: ThreadPost[] } }
const posts = fixture.post_stream.posts
const post = (n: number) => posts.find((p) => p.post_number === n) as ThreadPost

describe('chiefDelphiTopicId', () => {
  it('reads the id with or without a slug and a post number', () => {
    const slug = 'scriw-xv-south-carolina-robotics-invitational-and-workshops-2026'
    expect(chiefDelphiTopicId(`https://www.chiefdelphi.com/t/${slug}/523187/9`)).toBe(523187)
    expect(chiefDelphiTopicId(`https://www.chiefdelphi.com/t/${slug}/523187`)).toBe(523187)
    expect(chiefDelphiTopicId('https://www.chiefdelphi.com/t/523187')).toBe(523187)
    expect(chiefDelphiTopicId('https://www.chiefdelphi.com/t/523187/9')).toBe(523187)
    expect(chiefDelphiTopicId('https://chiefdelphi.com/t/523187.json')).toBe(523187)
    expect(chiefDelphiTopicId(`https://www.chiefdelphi.com/t/${slug}/523187/9?u=someone`)).toBe(523187)
  })

  it('refuses anything that is not a Chief Delphi thread', () => {
    expect(isChiefDelphiThread('https://www.chiefdelphi.com/c/competition/offseason/11')).toBe(false)
    expect(isChiefDelphiThread('https://www.chiefdelphi.com/u/billfred')).toBe(false)
    expect(isChiefDelphiThread('https://scriw.org/teams')).toBe(false)
    expect(isChiefDelphiThread('https://evil.example/t/slug/523187')).toBe(false)
    expect(isChiefDelphiThread('not a url')).toBe(false)
    expect(isChiefDelphiThread(null)).toBe(false)
  })
})

describe('pickRosterPost', () => {
  it('picks post 9, the newest roster by the topic author', () => {
    expect(pickRosterPost(posts, 'Billfred')?.post_number).toBe(9)
  })

  it('does not see a roster in a question or in prose', () => {
    expect(looksLikeRosterPost(post(7).cooked)).toBe(false)
    expect(looksLikeRosterPost(post(8).cooked)).toBe(false)
    // Post 9's sentence alone names 4083, 11167 and 281: not a roster.
    expect(looksLikeRosterPost(post(9).cooked.split('<div class="md-table">')[0])).toBe(false)
  })

  it('skips a newer roster post by someone else while the author posts rosters', () => {
    const intruder: ThreadPost = { ...post(1), id: 1, post_number: 10, username: 'someone_else' }
    expect(pickRosterPost([...posts, intruder], 'Billfred')?.post_number).toBe(9)
  })

  it('takes anyone’s roster post when the author never posts one', () => {
    const others = posts.map((p) => ({ ...p, username: p.post_number === 3 ? 'volunteer' : p.username }))
    expect(pickRosterPost(others.filter((p) => p.post_number <= 3 || p.post_number === 7), 'nobody')?.post_number).toBe(3)
  })

  it('ignores a roster the author quotes from an older post', () => {
    const quoted: ThreadPost = {
      ...post(7),
      post_number: 10,
      username: 'Billfred',
      cooked: `<aside class="quote"><blockquote>${post(1).cooked}</blockquote></aside><p>See above.</p>`,
    }
    expect(pickRosterPost([...posts, quoted], 'Billfred')?.post_number).toBe(9)
  })

  it('skips hidden and deleted posts', () => {
    const edited = posts.map((p) => (p.post_number === 9 ? { ...p, deleted_at: '2026-09-21T00:00:00Z' } : p))
    expect(pickRosterPost(edited, 'Billfred')?.post_number).toBe(6)
  })

  it('returns null for a thread with no roster', () => {
    expect(pickRosterPost([post(7), post(8)], 'Billfred')).toBeNull()
  })
})

describe('readRosterFromPost', () => {
  it('reads post 9: 27 in the field, 2 on the waitlist', () => {
    const teams = readRosterFromPost(post(9).cooked)
    const field = teams.filter((t) => !t.waitlisted)
    const wait = teams.filter((t) => t.waitlisted)
    expect(field.length).toBe(27)
    expect(wait.map((t) => `${t.number}${t.robot ?? ''}@${t.waitlistPosition}`)).toEqual(['1102B@1', '3459B@2'])
    // The team moved in from the waitlist is in the field; the team that stepped aside is gone.
    expect(field.some((t) => t.number === 11167)).toBe(true)
    expect(field.some((t) => t.number === 281 && t.name === 'The GreenVillains')).toBe(true)
    expect(teams.some((t) => t.number === 4083)).toBe(false)
    // "99xx | 3506 B-Team" is 3506's second robot, not team 99.
    expect(field.some((t) => t.number === 3506 && t.robot === 'B')).toBe(true)
    expect(teams.some((t) => t.number === 99)).toBe(false)
  })

  it('reads post 6: 26 in the field, 6 on the waitlist in listed order', () => {
    const teams = readRosterFromPost(post(6).cooked)
    expect(teams.filter((t) => !t.waitlisted).length).toBe(26)
    expect(teams.filter((t) => t.waitlisted).map((t) => `${t.number}${t.robot ?? ''}`)).toEqual([
      '10388',
      '10290',
      '11167',
      '3506B',
      '1102B',
      '3459B',
    ])
  })

  it('reads post 1 with no waitlist', () => {
    const teams = readRosterFromPost(post(1).cooked)
    expect(teams.map((t) => t.number)).toEqual([2815, 3489, 4533, 9496, 10367])
    expect(teams.every((t) => !t.waitlisted)).toBe(true)
  })

  it('reads a list, and a waitlist under its own heading', () => {
    const html = `<p>Current teams:</p>
<ul><li>254 - The Cheesy Poofs</li><li>1678 Citrus Circuits</li><li>4611 B</li><li>118 Robonauts</li><li>971 Spartan Robotics</li><li>10xxx - Rookie Squad</li></ul>
<h2>Waitlist</h2>
<ol><li>2056 OP Robotics</li><li>1114 Simbotics</li></ol>`
    const teams = readRosterFromPost(html)
    expect(teams.filter((t) => !t.waitlisted).map((t) => `${t.number}${t.robot ?? ''}`)).toEqual([
      '118',
      '254',
      '971',
      '1678',
      '4611B',
      '9970',
    ])
    expect(teams.find((t) => t.number === 9970)?.name).toBe('Rookie Squad')
    expect(teams.filter((t) => t.waitlisted).map((t) => `${t.number}@${t.waitlistPosition}`)).toEqual(['2056@1', '1114@2'])
  })

  it('reads line-broken paragraphs but never a sentence', () => {
    const lines = '<p>254 Cheesy Poofs<br>1678 Citrus Circuits<br>118 Robonauts<br>971 Spartan Robotics<br>2056 OP Robotics</p>'
    expect(readRosterFromPost(lines).length).toBe(5)
    const prose = '<p>Welcome 254, 1678, 118, 971, 2056 and 1114! 4083 stepped aside so 11167 and 281 could play.</p>'
    expect(readRosterFromPost(prose)).toEqual([])
  })

  it('skips a slot-index column and reads the team column beside it', () => {
    const rows = [254, 1678, 118, 971, 2056, 1114]
      .map((n, i) => `<tr><td>${i + 1}</td><td>${n}</td><td>Name ${n}</td></tr>`)
      .join('')
    const html = `<table><thead><tr><th>#</th><th>Team</th><th>Name</th></tr></thead><tbody>${rows}</tbody></table>`
    expect(readRosterFromPost(html).map((t) => t.number)).toEqual([118, 254, 971, 1114, 1678, 2056])
  })
})

describe('parseEntryText', () => {
  it('reads team entries and refuses placeholders', () => {
    expect(parseEntryText('4611 B')).toEqual({ number: 4611, robot: 'B' })
    expect(parseEntryText('4611 #2')).toEqual({ number: 4611, robot: 'B' })
    expect(parseEntryText('254 A Team Name')).toEqual({ number: 254, robot: null, name: 'A Team Name' })
    expect(parseEntryText('99xx')).toBeNull()
    expect(parseEntryText('10xxx')).toBeNull()
  })
})

describe('fetchThreadPosts', () => {
  it('fetches posts beyond the first page in batches', async () => {
    // A long thread: the topic JSON carries 20 posts, the stream lists 45.
    const make = (n: number): ThreadPost => ({
      id: 1000 + n,
      post_number: n,
      username: n === 1 || n === 44 ? 'Billfred' : 'fan',
      created_at: '2026-09-01T00:00:00Z',
      cooked: n === 44 ? post(9).cooked : '<p>Any update?</p>',
    })
    const all = Array.from({ length: 45 }, (_, i) => make(i + 1))
    const urls: string[] = []
    const fetchJson = async (url: string) => {
      urls.push(url)
      if (url.endsWith('/t/523187.json')) {
        return {
          id: 523187,
          title: 'SCRIW',
          details: { created_by: { username: 'Billfred' } },
          post_stream: { stream: all.map((p) => p.id), posts: all.slice(0, 20) },
        }
      }
      const ids = [...url.matchAll(/post_ids\[\]=(\d+)/g)].map((m) => Number(m[1]))
      return { post_stream: { posts: all.filter((p) => ids.includes(p.id)) } }
    }
    const thread = await fetchThreadPosts(523187, fetchJson)
    expect(thread.posts.length).toBe(45)
    expect(thread.author).toBe('Billfred')
    expect(urls.filter((u) => u.includes('posts.json')).length).toBe(2)

    const roster = await readChiefDelphiRoster(
      'https://www.chiefdelphi.com/t/scriw-xv/523187/1',
      'SCRIW XV',
      fetchJson,
    )
    expect(roster?.postNumber).toBe(44)
    expect(roster?.postUrl).toBe('https://www.chiefdelphi.com/t/523187/44')
    expect(roster?.method).toBe('table')
    expect(roster?.teams.filter((t) => !t.waitlisted).length).toBe(27)
  })
})
