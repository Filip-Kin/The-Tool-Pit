import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fetchWithRelayFallback, refusalReason, relayFetch, relayResponse } from '../src/grants/relay-fetch.js'

const CLOUDFLARE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="390"></head><body><div class="main-wrapper"><h1>www.example.org</h1><p>Verifying you are human. This may take a few seconds.</p><noscript>Enable JavaScript and cookies to continue</noscript></div><script>window._cf_chl_opt={cvId:'3'}</script><div class="footer">Performance &amp; security by Cloudflare</div></body></html>`
const INCAPSULA = `<html style="height:100%"><head><META NAME="robots" CONTENT="noindex,nofollow"></head><body style="margin:0px;height:100%"><iframe id="main-iframe" src="/_Incapsula_Resource?CWUDNSAI=24&xinfo=1" frameborder=0 width="100%" height="100%">Request unsuccessful. Incapsula incident ID: 1234-5678</iframe></body></html>`
const AKAMAI = `<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>You don't have permission to access "http://www.example.com/grants" on this server.<P>Reference #18.8b3c1402.1727100000.1a2b3c4d</BODY></HTML>`
const DATADOME = `<html><head><title>example.com</title></head><body><script src="https://ct.captcha-delivery.com/c.js"></script><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=abc"></iframe></body></html>`
const REAL_PAGE_BEHIND_CF = `<html><head><title>Community Grants | Example Foundation</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head><body><main>${'<p>The Example Foundation funds STEM programs for students across the region, including robotics teams, science fairs and after-school clubs. Applications are reviewed quarterly by the grants committee. </p>'.repeat(12)}</main><footer>Performance &amp; security by Cloudflare</footer></body></html>`

describe('refusalReason', () => {
  it.each([401, 403, 406, 429, 503])('refuses HTTP %i', (status) => {
    expect(refusalReason(status, '<html>whatever</html>')).toBe(`HTTP ${status}`)
  })

  it('does not call a 404 or a 500 refused', () => {
    expect(refusalReason(404, '<html><body>Not found</body></html>')).toBeNull()
    expect(refusalReason(500, '')).toBeNull()
  })

  it('catches a Cloudflare challenge served with 200', () => {
    expect(refusalReason(200, CLOUDFLARE)).toMatch(/bot challenge/)
  })

  it('catches Incapsula, Akamai and DataDome walls', () => {
    expect(refusalReason(200, INCAPSULA)).toMatch(/bot challenge/)
    expect(refusalReason(200, AKAMAI)).toMatch(/bot challenge/)
    expect(refusalReason(200, DATADOME)).toMatch(/bot challenge/)
  })

  it('lets a real page through even with a Cloudflare script and footer', () => {
    expect(refusalReason(200, REAL_PAGE_BEHIND_CF)).toBeNull()
  })

  it('calls an empty 200 page refused, but not an empty 204', () => {
    expect(refusalReason(200, '   ')).toBe('empty body')
    expect(refusalReason(204, '')).toBeNull()
  })

  it('never judges a PDF by its body', () => {
    expect(refusalReason(200, '', 'application/pdf')).toBeNull()
  })

  it('takes a short plain page as a real answer', () => {
    expect(refusalReason(200, '<html><body><h1>Grants</h1><p>Applications open in March.</p></body></html>')).toBeNull()
  })
})

const realFetch = globalThis.fetch
const setEnv = (url: string, secret: string) => {
  process.env.FETCH_RELAY_URL = url
  process.env.FETCH_RELAY_SECRET = secret
}
const stubFetch = (fn: (input: string, init: RequestInit) => Promise<Response>) => {
  globalThis.fetch = fn as unknown as typeof fetch
}

describe('relay client', () => {
  afterEach(() => {
    delete process.env.FETCH_RELAY_URL
    delete process.env.FETCH_RELAY_SECRET
    globalThis.fetch = realFetch
  })

  it('is a no-op without FETCH_RELAY_URL', async () => {
    setEnv('', '')
    expect(await relayFetch('https://example.org/')).toBeNull()
    const direct = new Response('nope', { status: 403 })
    const out = await fetchWithRelayFallback('https://example.org/', async () => direct)
    expect(out).toMatchObject({ via: 'direct', refusal: 'HTTP 403', relayTried: false })
    expect(out.res).toBe(direct)
  })

  it('leaves a good direct read alone and never calls the relay', async () => {
    setEnv('http://relay.test:8791', 's')
    const spy = mock(async () => new Response(''))
    stubFetch(spy)
    const out = await fetchWithRelayFallback('https://example.org/', async () => new Response(REAL_PAGE_BEHIND_CF, { headers: { 'content-type': 'text/html' } }))
    expect(out.via).toBe('direct')
    expect(spy).not.toHaveBeenCalled()
  })

  it('retries a refused read through the relay, then renders when the relay is walled too', async () => {
    setEnv('http://relay.test:8791/', 's3cret')
    const calls: Array<{ url: string; body: { url: string; render: boolean }; secret: string | null }> = []
    stubFetch(async (input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { url: string; render: boolean }
      calls.push({ url: input, body, secret: new Headers(init.headers).get('x-relay-secret') })
      const result = body.render
        ? { status: 403, finalUrl: 'https://example.org/apply', contentType: 'text/html', body: REAL_PAGE_BEHIND_CF, encoding: 'text', truncated: false, rendered: true, chain: [body.url] }
        : { status: 200, finalUrl: body.url, contentType: 'text/html', body: CLOUDFLARE, encoding: 'text', truncated: false, rendered: false, chain: [body.url] }
      return Response.json(result)
    })
    const out = await fetchWithRelayFallback('https://example.org/', async () => new Response(CLOUDFLARE, { status: 403, headers: { 'content-type': 'text/html' } }))
    expect(calls.map((c) => [c.url, c.body.render, c.secret])).toEqual([
      ['http://relay.test:8791/fetch', false, 's3cret'],
      ['http://relay.test:8791/fetch', true, 's3cret'],
    ])
    expect(out).toMatchObject({ via: 'relay-render', refusal: 'HTTP 403', relayTried: true })
    expect(out.res.status).toBe(200)
    expect(out.res.url).toBe('https://example.org/apply')
    expect(await out.res.text()).toContain('Example Foundation')
  })

  it('hands back the direct response when the relay is down', async () => {
    setEnv('http://relay.test:8791', 's')
    stubFetch(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const direct = new Response('', { status: 503 })
    const out = await fetchWithRelayFallback('https://example.org/', async () => direct)
    expect(out).toMatchObject({ via: 'direct', refusal: 'HTTP 503', relayTried: true })
    expect(out.res).toBe(direct)
  })

  it('turns a base64 PDF back into bytes', async () => {
    const res = relayResponse({ status: 200, finalUrl: 'https://example.org/a.pdf', contentType: 'application/pdf', body: Buffer.from('%PDF-1.7').toString('base64'), encoding: 'base64', truncated: false, rendered: false, chain: [] })
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF')
    expect(res.url).toBe('https://example.org/a.pdf')
  })
})
