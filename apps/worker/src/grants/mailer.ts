/**
 * Resend transport for grant alerts.
 *
 * Deliberately a fetch wrapper rather than the `resend` npm package: that
 * package is a dependency of apps/web only, so it does not resolve from the
 * worker's own node_modules, and the send endpoint is one POST with a JSON
 * body. Nothing here needs an SDK.
 *
 * THE SANDBOX RULE, verified against the live account rather than the docs:
 * while RESEND_FROM is still Resend's shared default sender
 * (onboarding@resend.dev), the API will only deliver to the account owner's
 * own address. Any other recipient comes back 403 with a message telling you
 * to verify a domain. That is a permanent refusal for that recipient, not a
 * transient failure, so retrying it just burns attempts and fills the log.
 * The drain therefore asks canDeliverTo() first and skips recipients it knows
 * will be refused, and treats a refusal that slips through as a hard failure.
 *
 * ALL OF THIS DISAPPEARS the moment a real domain is verified in Resend and
 * RESEND_FROM points at an address on it: isSandboxSender() goes false,
 * canDeliverTo() starts returning true for everyone, and no other code
 * changes. RESEND_SANDBOX_OWNER only exists to name the one address the
 * sandbox will accept.
 */

// #region config

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Resend's default account limit is 2 requests per second. The drain sends in
 * a tight loop, so pace it here rather than discovering the 429 in production.
 */
const MIN_REQUEST_INTERVAL_MS = 600

/** Senders that can only reach the account owner. Resend's shared test domain. */
const SANDBOX_SENDER_DOMAINS = ['resend.dev']

let lastRequestAt = 0

function fromAddress(): string {
  return process.env.RESEND_FROM?.trim() || 'onboarding@resend.dev'
}

/** The bare address out of `Name <addr@example.com>` or a plain address. */
function bareAddress(value: string): string {
  const angled = value.match(/<([^>]+)>/)
  return (angled ? angled[1] : value).trim().toLowerCase()
}

/**
 * True while the configured sender is one of Resend's shared test domains, so
 * delivery is restricted to the account owner.
 */
export function isSandboxSender(): boolean {
  const domain = bareAddress(fromAddress()).split('@')[1] ?? ''
  return SANDBOX_SENDER_DOMAINS.includes(domain)
}

/** The only address the sandbox sender can reach, lower-cased. Null when unset. */
export function sandboxOwner(): string | null {
  const raw = process.env.RESEND_SANDBOX_OWNER?.trim()
  return raw ? bareAddress(raw) : null
}

/**
 * Can we actually deliver to this address today?
 *
 * False only in the sandbox case, and only for an address that is not the
 * account owner's. Callers use this to skip a send before spending an attempt,
 * and MUST log the skip: a recipient we quietly never mail is exactly the kind
 * of silent cap this product does not allow.
 */
export function canDeliverTo(address: string): boolean {
  if (!isSandboxSender()) return true
  const owner = sandboxOwner()
  // No owner configured: we cannot tell which single address would work, so
  // do not guess. Every send is refused and the log says why.
  if (!owner) return false
  return bareAddress(address) === owner
}

/** One line explaining a canDeliverTo() refusal, for the log and the alert row. */
export function sandboxRefusalReason(address: string): string {
  const owner = sandboxOwner()
  return (
    `RESEND_FROM is still the unverified default sender ${fromAddress()}, which can only deliver to ` +
    (owner ? `the account owner ${owner}` : 'the account owner (RESEND_SANDBOX_OWNER is not set)') +
    `. Skipped ${bareAddress(address)}. Verify a domain in Resend and set RESEND_FROM to clear this.`
  )
}

// #endregion

// #region send

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  /**
   * `retryable: false` means sending the same message to the same address will
   * fail again, so the caller stops instead of counting down its attempts.
   */
  | { ok: false; retryable: boolean; error: string }

/** Addresses we have already warned about, so one misconfiguration is one log line. */
const warnedRecipients = new Set<string>()

/**
 * Warn once per recipient per worker process. A sweep can hold hundreds of
 * alerts for the same handful of people, and repeating the same paragraph for
 * each one buries everything else in the log.
 */
function warnOnce(address: string, message: string): void {
  const key = bareAddress(address)
  if (warnedRecipients.has(key)) return
  warnedRecipients.add(key)
  console.warn(`[grants:mailer] ${message}`)
}

/** Is this 403 the "your sender is unverified" refusal rather than a bad key? */
function isDomainVerificationRefusal(status: number, message: string): boolean {
  if (status !== 403) return false
  return /verify a domain|only send testing emails|own email address/i.test(message)
}

/**
 * Send one email. Never throws: the drain has to record an outcome per alert
 * row, and an exception halfway through a batch would leave the rest untouched
 * with nothing written down about why.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Configuration, not delivery. Retrying every alert against a missing key
    // would exhaust their attempts before anyone notices the env var is unset.
    return { ok: false, retryable: false, error: 'RESEND_API_KEY is not set' }
  }

  if (!canDeliverTo(input.to)) {
    const reason = sandboxRefusalReason(input.to)
    warnOnce(input.to, reason)
    return { ok: false, retryable: false, error: reason }
  }

  const since = Date.now() - lastRequestAt
  if (since < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - since))
  }
  lastRequestAt = Date.now()

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    })
  } catch (err) {
    // Network-level failure. Worth another go on the next drain pass.
    return { ok: false, retryable: true, error: `resend request failed: ${(err as Error).message}` }
  }

  const bodyText = await res.text().catch(() => '')

  if (res.ok) {
    let id: string | null = null
    try {
      id = (JSON.parse(bodyText) as { id?: string }).id ?? null
    } catch {
      // A 200 with an unparseable body still means it was accepted.
    }
    return { ok: true, id }
  }

  let message = bodyText.slice(0, 400)
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; error?: string; name?: string }
    message = parsed.message ?? parsed.error ?? message
  } catch {
    // Keep the raw text.
  }

  if (isDomainVerificationRefusal(res.status, message)) {
    // The sandbox rule caught at the API rather than by canDeliverTo(), which
    // means RESEND_SANDBOX_OWNER is wrong or unset. Name the recipient, say
    // what the sender is, and mark it dead so the row is not retried forever.
    const reason =
      `Resend refused ${bareAddress(input.to)}: RESEND_FROM (${fromAddress()}) is an unverified default sender, ` +
      `so only the account owner can receive mail. Verify a domain in Resend and set RESEND_FROM, or set ` +
      `RESEND_SANDBOX_OWNER so the drain skips addresses it cannot reach. Resend said: ${message}`
    warnOnce(input.to, reason)
    return { ok: false, retryable: false, error: reason }
  }

  // 401/403 on the key itself and 422 on a malformed message will not fix
  // themselves. 429 and 5xx will.
  const retryable = res.status === 429 || res.status >= 500
  return { ok: false, retryable, error: `resend ${res.status}: ${message}` }
}

// #endregion
