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
  /** The main action. Rendered as the green primary button. */
  cta?: { label: string; url: string }
  /**
   * An optional lesser action next to the primary one, e.g. "Not right? Remove
   * it" beside "Claim it". Rendered as the outlined secondary button. Most
   * emails have one action and leave this unset; the shell renders it only when
   * given, so every email that DOES have two actions looks the same.
   */
  secondaryCta?: { label: string; url: string }
  /** Why this person is getting this email. One short sentence. */
  reason: string
  preferencesUrl: string
}

// #region visual system

/**
 * The one visual shell every email shares.
 *
 * ONE LOOK FOR EVERY KIND. A published notice, a rejection, an invite, an
 * outreach hello and a grant alert are all the same clean white card on a grey
 * page: the frc.tools wordmark, the heading, the copy, an optional facts table,
 * a green primary button (and an outlined secondary one when there are two
 * actions), and a muted one-line footer. Nothing about the shell changes with
 * the kind, only the words inside it, so the site never sends two emails that
 * look like two different products.
 *
 * The wordmark links to the bare production origin rather than to siteUrl(),
 * because this module carries no imports on purpose (see the file header): it
 * is pure string building called from a server component, a worker job and a
 * test alike, and reading an env var here would drag Node's types into a
 * package that deliberately has none.
 */
const BRAND = '#16a34a'
const WORDMARK_URL = 'https://frc.tools'

// #endregion

/**
 * One layout for every email we send. Inline styles only, because email
 * clients strip <style> blocks, and a light background because most clients
 * ignore prefers-color-scheme and would otherwise render dark text on dark.
 */
export function layout(input: LayoutInput): { html: string; text: string } {
  const { heading, paragraphs, facts = [], cta, secondaryCta, reason, preferencesUrl } = input

  const factRows = facts
    .map(
      (f) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#666;font-size:14px;vertical-align:top;white-space:nowrap">${esc(f.label)}</td>` +
        `<td style="padding:4px 0;color:#111;font-size:14px">${esc(f.value)}</td></tr>`,
    )
    .join('')

  const primaryButton = cta
    ? `<a href="${esc(cta.url)}" style="display:inline-block;padding:10px 18px;` +
      `background:${BRAND};color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600">${esc(cta.label)}</a>`
    : ''
  const secondaryButton = secondaryCta
    ? `<a href="${esc(secondaryCta.url)}" style="display:inline-block;padding:9px 17px;margin-left:8px;` +
      `background:#ffffff;color:${BRAND};text-decoration:none;border:1px solid ${BRAND};border-radius:6px;font-size:15px">${esc(secondaryCta.label)}</a>`
    : ''

  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5">',
    '<div style="max-width:560px;margin:0 auto;padding:24px 20px">',
    // The wordmark, so every email is visibly from frc.tools before a word of
    // copy is read.
    `<div style="margin:0 0 16px"><a href="${WORDMARK_URL}" style="color:${BRAND};font-size:18px;font-weight:700;text-decoration:none;letter-spacing:-0.01em">frc.tools</a></div>`,
    // The clean card.
    '<div style="padding:24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;',
    'color:#111;line-height:1.5">',
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111">${esc(heading)}</h1>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;color:#111">${esc(p)}</p>`),
    factRows
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${factRows}</table>`
      : '',
    cta ? `<p style="margin:20px 0">${primaryButton}${secondaryButton}</p>` : '',
    '<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px">',
    `<p style="margin:0 0 6px;font-size:12px;color:#666">${esc(reason)}</p>`,
    `<p style="margin:0;font-size:12px;color:#666"><a href="${esc(preferencesUrl)}" style="color:${BRAND}">Manage these emails</a></p>`,
    '</div></div></body></html>',
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
    ...(cta ? [`${cta.label}: ${cta.url}`, ''] : []),
    ...(secondaryCta ? [`${secondaryCta.label}: ${secondaryCta.url}`, ''] : []),
    '--',
    reason,
    `Manage these emails: ${preferencesUrl}`,
  ].join('\n')

  return { html, text }
}

// #endregion
