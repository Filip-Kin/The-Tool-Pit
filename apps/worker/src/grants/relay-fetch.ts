/**
 * Read a page through the home NAS when the worker's own IP is refused.
 *
 * The worker runs in a datacenter, and a good share of funder sites answer
 * that IP with a Cloudflare or Incapsula 403, or a 200 that is only a
 * challenge page. The same pages load from a residential IP. fetch-relay
 * (Projects/fetch-relay, on the NAS, reached over Tailscale) does the read
 * and hands back the status, the final URL and the body, plain or rendered in
 * its own Chromium.
 *
 * Off unless FETCH_RELAY_URL and FETCH_RELAY_SECRET are both set: every
 * function here is then a no-op that returns null or the direct response, so
 * a dev box and CI behave exactly as before.
 *
 * Whatever came through the relay says so (`via`), and callers carry that into
 * the evidence so a reviewer can tell a page the worker read from a page the
 * NAS read for it.
 */

export type FetchVia = 'direct' | 'relay' | 'relay-render'

export interface RelayResult {
  status: number
  finalUrl: string
  contentType: string
  body: string
  /** 'base64' for non-text bodies (a PDF). */
  encoding: 'text' | 'base64'
  truncated: boolean
  rendered: boolean
  chain: string[]
}

const PLAIN_TIMEOUT_MS = 25_000
const RENDER_TIMEOUT_MS = 35_000
/** The relay's own timeout plus the tailnet round trip. */
const CLIENT_SLACK_MS = 10_000

function relayConfig(): { url: string; secret: string } | null {
  const url = process.env.FETCH_RELAY_URL?.trim()
  const secret = process.env.FETCH_RELAY_SECRET?.trim()
  if (!url || !secret) return null
  return { url: url.replace(/\/+$/, ''), secret }
}

export function relayConfigured(): boolean {
  return relayConfig() !== null
}

// #region detection

/** Statuses that mean "not to you", as opposed to "not here". */
const REFUSED_STATUS = new Set([401, 403, 406, 429, 503])

/**
 * Bot-wall pages. Each marker only counts on a page with little visible text,
 * because a real page behind Cloudflare or Imperva carries some of the same
 * scripts and footers.
 */
const CHALLENGE_MARKERS: RegExp[] = [
  /<title>\s*just a moment/i,
  /checking (if the site connection is secure|your browser)/i,
  /cf-browser-verification|cf_chl_opt|cf-challenge/i,
  /attention required! \| cloudflare/i,
  /enable javascript and cookies to continue/i,
  /verify(ing)? (that )?you are (a )?human/i,
  /performance (&|&amp;) security by cloudflare/i,
  /please complete the security check/i,
  /incapsula incident id|request unsuccessful\. incapsula|_incapsula_resource/i,
  /captcha-delivery\.com/i,
  /px-captcha|press (&|&amp;) hold to confirm/i,
  /sucuri website firewall/i,
  /ddos-guard/i,
  /awswafcookiedomainlist|aws-waf-token/i,
  /vercel security checkpoint/i,
  /access denied[\s\S]{0,600}reference #\s*\d/i,
]

/** A challenge page is short. A real page that mentions a check is not. */
const THIN_TEXT_CHARS = 1500

function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const HTMLISH = /html|xml|text\/plain/i
const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

/**
 * Why a response counts as refused, or null when it is a real answer.
 * Refused means: a refusal status, a bot-challenge page, or an empty body
 * where a page was expected. A 404 is a real answer and is not refused.
 */
export function refusalReason(status: number, body: string, contentType = 'text/html'): string | null {
  if (REFUSED_STATUS.has(status)) return `HTTP ${status}`
  if (contentType && !HTMLISH.test(contentType)) return null
  if (!body.trim()) return status >= 200 && status < 300 && !NULL_BODY_STATUS.has(status) ? 'empty body' : null
  const text = visibleText(body.slice(0, 200_000))
  if (text.length < THIN_TEXT_CHARS) {
    const head = body.slice(0, 60_000)
    const hit = CHALLENGE_MARKERS.find((re) => re.test(head))
    if (hit) return `bot challenge (${hit.source.split('|')[0]!.replace(/\\/g, '').slice(0, 40)})`
  }
  return null
}

// #endregion

// #region relay client

/**
 * One read through the relay. Null when the relay is off, unreachable, refuses
 * the URL, or errors; the caller keeps what it had.
 */
export async function relayFetch(url: string, opts: { render?: boolean; timeoutMs?: number } = {}): Promise<RelayResult | null> {
  const cfg = relayConfig()
  if (!cfg) return null
  const timeoutMs = opts.timeoutMs ?? (opts.render ? RENDER_TIMEOUT_MS : PLAIN_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs + CLIENT_SLACK_MS)
  try {
    const res = await fetch(`${cfg.url}/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-secret': cfg.secret },
      body: JSON.stringify({ url, render: opts.render === true, timeoutMs }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.warn(`[relay] ${opts.render ? 'render' : 'fetch'} ${url}: relay answered ${res.status} ${detail.slice(0, 160)}`)
      return null
    }
    return (await res.json()) as RelayResult
  } catch (err) {
    console.warn(`[relay] ${opts.render ? 'render' : 'fetch'} ${url} failed: ${String(err).split('\n')[0]}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A relay result as a fetch Response, so existing readers take it unchanged. */
export function relayResponse(r: RelayResult): Response {
  const status = r.status >= 200 && r.status <= 599 ? r.status : 200
  const body = NULL_BODY_STATUS.has(status) ? null : r.encoding === 'base64' ? Buffer.from(r.body, 'base64') : r.body
  const res = new Response(body, { status, headers: { 'content-type': r.contentType || 'text/html' } })
  Object.defineProperty(res, 'url', { value: r.finalUrl })
  return res
}

/** Rendered HTML via the relay's browser, or null when it is off, fails, or also hits a wall. */
export async function relayRenderedHtml(url: string): Promise<string | null> {
  const r = await relayFetch(url, { render: true })
  if (!r || r.encoding !== 'text' || r.body.length < 500) return null
  // A rendered page's goto status is the first response, which is the
  // challenge's 403 even when the browser then passed it; judge the DOM.
  return refusalReason(200, r.body) ? null : r.body
}

export interface FetchOutcome {
  res: Response
  via: FetchVia
  /** Why the direct read was refused, when it was. */
  refusal: string | null
  /** True when the relay was asked and could not do better. */
  relayTried: boolean
}

/**
 * Direct first; the relay only when the direct read was refused.
 *
 * Refused direct -> relay plain -> relay render (only when the plain relay
 * read was refused too, since a JS challenge often passes in a real browser).
 * When the relay cannot do better the direct response comes back unchanged,
 * so the caller's own fallbacks (local browser, Wayback copy) still run. A
 * direct read that threw is retried through the relay; if the relay also
 * fails, the original error is rethrown.
 */
export async function fetchWithRelayFallback(url: string, direct: () => Promise<Response>): Promise<FetchOutcome> {
  let res: Response | null = null
  let thrown: unknown = null
  let refusal: string | null
  try {
    res = await direct()
    const ct = res.headers.get('content-type') ?? ''
    const peek = res.ok && (!ct || HTMLISH.test(ct)) ? await res.clone().text() : ''
    refusal = refusalReason(res.status, peek, ct)
  } catch (err) {
    thrown = err
    refusal = `fetch failed: ${String(err).split('\n')[0]}`
  }
  if (!refusal && res) return { res, via: 'direct', refusal: null, relayTried: false }
  if (!relayConfigured()) {
    if (res) return { res, via: 'direct', refusal, relayTried: false }
    throw thrown
  }

  const plain = await relayFetch(url)
  if (plain && !refusalReason(plain.status, plain.encoding === 'text' ? plain.body : 'binary', plain.contentType)) {
    console.log(`[relay] ${url} read via relay (direct: ${refusal})`)
    return { res: relayResponse(plain), via: 'relay', refusal, relayTried: true }
  }
  const rendered = await relayFetch(url, { render: true })
  if (rendered && rendered.encoding === 'text' && !refusalReason(200, rendered.body, rendered.contentType)) {
    console.log(`[relay] ${url} rendered via relay (direct: ${refusal})`)
    return { res: relayResponse({ ...rendered, status: 200 }), via: 'relay-render', refusal, relayTried: true }
  }
  if (res) return { res, via: 'direct', refusal, relayTried: true }
  throw thrown
}

/** A note line for evidence, or null for a direct read. */
export function viaNote(url: string, via: FetchVia): string | null {
  if (via === 'relay') return `read ${url} via the NAS fetch relay (the worker's IP was refused)`
  if (via === 'relay-render') return `read ${url} via the NAS fetch relay, rendered in its browser (the worker's IP was refused)`
  return null
}

// #endregion
