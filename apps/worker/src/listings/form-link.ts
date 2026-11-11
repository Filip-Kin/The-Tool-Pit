/**
 * Open an event's registration or volunteer link and say what is there.
 *
 * Two reasons, both from Filip on 2026-11-11. A link the refresh wrote must
 * open: MadTown's volunteer link was a 2022 Google Form that now answers "Page
 * Not Found". And the form itself is worth reading: its description often
 * carries the fee, the deadline, the team cap or a waitlist note that the
 * event's site does not.
 *
 * The read is the grants apply-route reader (direct fetch, the browser for a
 * 404 that a browser can still open, the NAS relay for a refused IP), so a
 * form host that blocks the worker is handled the same way in both verticals.
 */
import { CLOSED_RE, readHtml } from '../grants/apply-route.js'
import { htmlToText } from '../connectors/playwright-render.js'

export type FormLinkState = 'open' | 'closed' | 'gone' | 'unreadable'

export interface FormLinkRead {
  url: string
  state: FormLinkState
  /** Visible text of the form, its title and description first. Empty when gone or unreadable. */
  text: string
  /** One line a person can check: the status or the words that decided it. */
  evidence: string
}

/** Google's own wording on a form that was deleted or never shared. */
const GONE_RE = /\b(page not found|sorry, the file you have requested does not exist|this form (has been|was) deleted|no longer exists)\b/i

/** Pure: the verdict on what came back. */
export function judgeFormLink(url: string, read: { html: string; how: string; status: number; finalUrl: string }): FormLinkRead {
  if (read.how === 'gone') return { url, state: 'gone', text: '', evidence: `HTTP ${read.status}` }
  if (read.how === 'walled' || !read.html) return { url, state: 'unreadable', text: '', evidence: read.how }
  const text = htmlToText(read.html).replace(/\s+/g, ' ').trim()
  const head = text.slice(0, 3000)
  const gone = head.match(GONE_RE)
  if (gone && text.length < 2000) return { url, state: 'gone', text: '', evidence: gone[0] }
  if (/\/closedform\b/.test(read.finalUrl)) return { url, state: 'closed', text, evidence: 'Google Form closedform' }
  const closed = head.match(CLOSED_RE)
  if (closed) return { url, state: 'closed', text, evidence: closed[0] }
  return { url, state: 'open', text, evidence: `HTTP ${read.status}` }
}

export async function readFormLink(url: string): Promise<FormLinkRead> {
  try {
    const read = await readHtml(url)
    return judgeFormLink(url, read)
  } catch (err) {
    return { url, state: 'unreadable', text: '', evidence: String(err).slice(0, 120) }
  }
}
