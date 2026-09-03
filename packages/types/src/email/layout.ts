/**
 * The one email layout, and the formatters every template shares.
 *
 * ZERO imports on purpose. This module is pure string building, so it can be
 * called from a server component, a server action, a worker job or a test
 * without dragging in the DB client or React.
 *
 * It lives in packages/types rather than in either app because both apps send
 * mail and both need identical bodies. It used to live in apps/web with a
 * hand-kept copy in apps/worker, because the worker's tsconfig sets
 * `rootDir: ./src` and tsc refuses any source outside it (TS6059). Two copies
 * of a template is two templates that drift, so the module moved here, which
 * both apps already depend on.
 */

// #region shared

export interface EmailBody {
  subject: string
  html: string
  text: string
}

/** One label/value row in the facts table. An empty label continues the row above. */
export interface EmailFact {
  label: string
  value: string
  /**
   * A blank the reader is meant to notice, not a fact we hold. Rendered in the
   * muted colour with the value read as a prompt ("Not listed - add it") rather
   * than as data. This is the whole point of the outreach card: an organiser
   * fixes what they can see is missing, so the gaps are shown, not hidden.
   */
  muted?: boolean
}

/** Escape for interpolation into HTML text or an attribute value. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Format a deadline for an email.
 *
 * An email cannot know the reader's clock, so it has to pick one zone and name
 * it. We default to US Eastern because the grants in this vertical are almost
 * all US funders quoting US closing times, and an unlabelled time is worse
 * than a labelled one in the wrong zone. `timeZoneName: 'short'` means the
 * reader always sees which zone they are being told.
 */
export function formatDeadline(at: Date, timeZone = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(at)
}

/** Money as a plain range. Returns null when we do not know the size. */
export function formatAward(min: number | null, max: number | null, currency = 'USD'): string | null {
  const symbol = currency === 'USD' ? '$' : `${currency} `
  const n = (v: number) => `${symbol}${v.toLocaleString('en-US')}`
  if (min != null && max != null) return min === max ? n(min) : `${n(min)} to ${n(max)}`
  if (max != null) return `up to ${n(max)}`
  if (min != null) return `from ${n(min)}`
  return null
}

export interface LayoutInput {
  /** Big line at the top. Usually the same as the subject, minus the prefix. */
  heading: string
  /** Body paragraphs, already plain text. Rendered in order. */
  paragraphs: string[]
  /** Optional label/value rows, e.g. Deadline, Award, Funder. */
  facts?: EmailFact[]
  /** The main action. Rendered as the primary (indigo) button. */
  cta?: { label: string; url: string }
  /**
   * An optional lesser action next to the primary one, e.g. "Not right? Remove
   * it" beside "Claim it". Rendered as the outlined secondary button. Most
   * emails have one action and leave this unset; the shell renders it only when
   * given, so every email that DOES have two actions looks the same.
   */
  secondaryCta?: { label: string; url: string }
  /**
   * One short line rendered immediately above the buttons, after the facts
   * table. It is where a call to action that has to follow the card goes, e.g.
   * "Is this yours? You can take it over and keep the details right:" on the
   * outreach email, whose "Here is what we have:" intro, card and claim prompt
   * only read in the right order if the prompt sits between the card and the
   * buttons rather than before the card.
   */
  ctaIntro?: string
  /** Why this person is getting this email. One short sentence. */
  reason: string
  preferencesUrl: string
  /**
   * A no-login "stop all email to this address" link, tokenised for the
   * recipient. Optional because the caller has to mint it per address (it is
   * signed, and this package carries no crypto): the outbox drain knows the
   * address at send time and passes one, so every email it sends carries the
   * unsubscribe line beside the preferences link.
   */
  unsubscribeUrl?: string
}

// #region visual system

/**
 * The one visual shell every email shares, in the site's own dark palette.
 *
 * ONE LOOK FOR EVERY KIND. A published notice, a rejection, an invite, an
 * outreach hello and a grant alert are all the same dark card on the near-black
 * page frc.tools uses: the FRC.tools wordmark (".tools" in the indigo accent),
 * the heading, the copy, an optional facts table, an indigo primary button (and
 * an outlined secondary one when there are two actions), and a muted footer.
 * Nothing about the shell changes with the kind, only the words inside it, so
 * the site never sends two emails that look like two different products, and
 * the email matches the site a reader clicks through to rather than a stray
 * light-mode green that belongs to nothing.
 *
 * The values are the site's own CSS custom properties, copied here as literals
 * because an email cannot read a stylesheet: --color-background, --color-surface,
 * --color-border, --color-foreground, --color-muted, --color-primary. Keep them
 * in step with apps/web/app/globals.css.
 *
 * ROBUST IN REAL CLIENTS. Inline styles only, because clients strip <style>
 * blocks. A table shell rather than flex, because Outlook has no flexbox. And a
 * dark colour set on the body AND on the card, so a client that ignores the
 * body background still frames dark text on a dark card rather than dark on
 * white.
 *
 * The wordmark links to the bare production origin rather than to siteUrl(),
 * because this module carries no imports on purpose (see the file header): it
 * is pure string building called from a server component, a worker job and a
 * test alike, and reading an env var here would drag Node's types into a
 * package that deliberately has none.
 */
const PAGE_BG = '#0a0a0b'
const CARD_BG = '#111113'
const BORDER = '#2e2e34'
const TEXT = '#f0f0f2'
const MUTED = '#8b8b96'
const PRIMARY = '#6366f1'
const WORDMARK_URL = 'https://frc.tools'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

// #endregion

/**
 * One layout for every email we send. Inline styles only, dark surface, table
 * shell. See the visual-system note above for why every colour is a literal.
 */
export function layout(input: LayoutInput): { html: string; text: string } {
  const { heading, paragraphs, facts = [], cta, secondaryCta, ctaIntro, reason, preferencesUrl, unsubscribeUrl } =
    input

  const factRows = facts
    .map((f) => {
      // A "not listed" prompt reads in the muted colour so the gap is visibly a
      // gap; a real value reads in the body colour.
      const valueColor = f.muted ? MUTED : TEXT
      return (
        `<tr><td style="padding:5px 16px 5px 0;color:${MUTED};font-size:14px;vertical-align:top;white-space:nowrap">${esc(f.label)}</td>` +
        `<td style="padding:5px 0;color:${valueColor};font-size:14px">${esc(f.value)}</td></tr>`
      )
    })
    .join('')

  const primaryButton = cta
    ? `<a href="${esc(cta.url)}" style="display:inline-block;padding:10px 18px;` +
      `background:${PRIMARY};color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600">${esc(cta.label)}</a>`
    : ''
  const secondaryButton = secondaryCta
    ? `<a href="${esc(secondaryCta.url)}" style="display:inline-block;padding:9px 17px;margin-left:8px;` +
      `background:transparent;color:${TEXT};text-decoration:none;border:1px solid ${BORDER};border-radius:6px;font-size:15px">${esc(secondaryCta.label)}</a>`
    : ''

  const html = [
    `<!doctype html><html><body style="margin:0;padding:0;background:${PAGE_BG}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG}"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">`,
    // The wordmark, so every email is visibly from frc.tools before a word of
    // copy is read. ".tools" carries the indigo accent.
    `<tr><td style="padding:0 4px 16px"><a href="${WORDMARK_URL}" style="font-family:${FONT};font-size:18px;font-weight:700;text-decoration:none;letter-spacing:-0.01em;color:${TEXT}">FRC<span style="color:${PRIMARY}">.tools</span></a></td></tr>`,
    // The card.
    `<tr><td style="padding:24px;background:${CARD_BG};border:1px solid ${BORDER};border-radius:10px;font-family:${FONT};color:${TEXT};line-height:1.5">`,
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:${TEXT}">${esc(heading)}</h1>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;color:${TEXT}">${esc(p)}</p>`),
    factRows
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${factRows}</table>`
      : '',
    ctaIntro ? `<p style="margin:16px 0 0;font-size:15px;color:${TEXT}">${esc(ctaIntro)}</p>` : '',
    cta ? `<p style="margin:16px 0 4px">${primaryButton}${secondaryButton}</p>` : '',
    `<hr style="border:none;border-top:1px solid ${BORDER};margin:24px 0 12px">`,
    `<p style="margin:0 0 6px;font-size:12px;color:${MUTED}">${esc(reason)}</p>`,
    `<p style="margin:0;font-size:12px;color:${MUTED}"><a href="${esc(preferencesUrl)}" style="color:${MUTED};text-decoration:underline">Manage these emails</a>` +
      (unsubscribeUrl
        ? `&nbsp;&middot;&nbsp;<a href="${esc(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe from everything</a>`
        : '') +
      '</p>',
    '</td></tr></table></td></tr></table></body></html>',
  ]
    .filter(Boolean)
    .join('')

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    // An empty label continues the row above (a list under one heading), so in
    // plain text it indents rather than printing a bare colon.
    ...(facts.length ? [...facts.map((f) => (f.label ? `${f.label}: ${f.value}` : `  ${f.value}`)), ''] : []),
    ...(ctaIntro ? [ctaIntro, ''] : []),
    ...(cta ? [`${cta.label}: ${cta.url}`, ''] : []),
    ...(secondaryCta ? [`${secondaryCta.label}: ${secondaryCta.url}`, ''] : []),
    '--',
    reason,
    `Manage these emails: ${preferencesUrl}`,
    ...(unsubscribeUrl ? [`Unsubscribe from everything: ${unsubscribeUrl}`] : []),
  ].join('\n')

  return { html, text }
}

// #endregion
