import { afterEach, describe, it, expect, vi } from 'vitest'
import { askToaToDecide, toaKeysConfig } from '../src/discord/toa-keys.js'

const ENV = ['TOA_KEY_REQUESTS_CHANNEL_ID', 'TOA_DEV_ROLE_ID', 'TOA_DECISION_SECRET', 'TOA_API_BASE']
const cfg = { channelId: 'c', devRoleId: 'r', secret: 's3', base: 'https://toa.test' }

afterEach(() => {
  for (const k of ENV) delete process.env[k]
  vi.unstubAllGlobals()
})

describe('toaKeysConfig', () => {
  it('is off until channel, role and secret are all set', () => {
    process.env.TOA_KEY_REQUESTS_CHANNEL_ID = 'c'
    process.env.TOA_DEV_ROLE_ID = 'r'
    expect(toaKeysConfig()).toBeNull()
    process.env.TOA_DECISION_SECRET = 's3'
    expect(toaKeysConfig()).toEqual({ ...cfg, base: 'https://api.theorangealliance.org' })
  })

  it('reads TOA_API_BASE without a trailing slash', () => {
    Object.assign(process.env, { TOA_KEY_REQUESTS_CHANNEL_ID: 'c', TOA_DEV_ROLE_ID: 'r', TOA_DECISION_SECRET: 's3' })
    process.env.TOA_API_BASE = 'https://toa.test/'
    expect(toaKeysConfig()?.base).toBe('https://toa.test')
  })
})

describe('askToaToDecide', () => {
  it('posts the message id, decision and actor with the secret', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await askToaToDecide(cfg, 'm1', 'approve', 'Filip')).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://toa.test/api/discord/key-decision')
    expect(init.headers['x-internal-secret']).toBe('s3')
    expect(JSON.parse(init.body)).toEqual({ message_id: 'm1', decision: 'approve', actor: 'Filip' })
  })

  it('tells a post that is not a request apart from a refused decision', async () => {
    const body = (msg: string, status: number) => new Response(JSON.stringify({ _code: status, _message: msg }), { status })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body('Content not found.', 404)))
    expect(await askToaToDecide(cfg, 'm1', 'reject', 'F')).toEqual({ ok: false, notARequest: true, error: 'Content not found.' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body('Cannot reject a key that is not pending.', 409)))
    expect(await askToaToDecide(cfg, 'm1', 'reject', 'F')).toEqual({
      ok: false,
      notARequest: false,
      error: 'Cannot reject a key that is not pending.',
    })
  })
})
