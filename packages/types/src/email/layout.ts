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
  cta?: { label: string; url: string }
  /** Why this person is getting this email. One short sentence. */
  reason: string
  preferencesUrl: string
}

/**
 * One layout for every email we send. Inline styles only, because email
 * clients strip <style> blocks, and a light background because most clients
 * ignore prefers-color-scheme and would otherwise render dark text on dark.
 */
export function layout(input: LayoutInput): { html: string; text: string } {
  const { heading, paragraphs, facts = [], cta, reason, preferencesUrl } = input

  const factRows = facts
    .map(
      (f) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#666;font-size:14px;vertical-align:top;white-space:nowrap">${esc(f.label)}</td>` +
        `<td style="padding:4px 0;color:#111;font-size:14px">${esc(f.value)}</td></tr>`,
    )
    .join('')

  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5">',
    '<div style="max-width:560px;margin:0 auto;padding:24px 20px;background:#ffffff;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;',
    'color:#111;line-height:1.5">',
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111">${esc(heading)}</h1>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;color:#111">${esc(p)}</p>`),
    factRows
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${factRows}</table>`
      : '',
    cta
      ? `<p style="margin:20px 0"><a href="${esc(cta.url)}" style="display:inline-block;padding:10px 16px;` +
        `background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px">${esc(cta.label)}</a></p>`
      : '',
    '<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px">',
    `<p style="margin:0 0 6px;font-size:12px;color:#666">${esc(reason)}</p>`,
    `<p style="margin:0;font-size:12px;color:#666"><a href="${esc(preferencesUrl)}" style="color:#4f46e5">Manage these emails</a></p>`,
    '</div></body></html>',
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
    '--',
    reason,
    `Manage these emails: ${preferencesUrl}`,
  ].join('\n')

  return { html, text }
}

// #endregion
