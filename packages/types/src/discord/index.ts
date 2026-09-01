/**
 * The one Discord notifier.
 *
 * ONE WEBHOOK FOR EVERYTHING THAT NEEDS A DECISION. There used to be five
 * near-identical notify.ts modules, one per vertical, each reading its own
 * environment variable and each posting its own hand-rolled embed. Two of those
 * variables were never set in production and one, PHOTO_SUBMISSION_DISCORD_WEBHOOK,
 * pointed at a webhook Discord had deleted: it answered
 * {"message":"Unknown Webhook","code":10015} to every post and nobody found out,
 * because the call site was `void notify(...)` and the failure was swallowed by
 * an empty catch. A photo album submitted while that was true produced no
 * message at all.
 *
 * So: one destination, one embed shape, and a failure that says so.
 *
 *   - The URL comes from FIELD_SUBMISSION_DISCORD_WEBHOOK, the only one that is
 *     alive. The name is now wrong (it carries every vertical, not just fields)
 *     and should be renamed to APPROVAL_DISCORD_WEBHOOK the next time the
 *     Coolify environment is edited. It is read by the old name here so nothing
 *     has to change in Coolify for this to work today.
 *   - A post that fails LOGS THE STATUS AND THE BODY. Discord answers a dead
 *     webhook with a JSON error, and that error is the only warning you get.
 *     It is the actual bug this module exists to fix.
 *   - It still never throws. A submission must not fail because Discord is
 *     having a day, so callers may keep firing this without awaiting it. But
 *     they must not silence it: the log line is the whole point.
 *
 * Lives in @the-tool-pit/types, beside the email templates, for the same
 * reason they do: apps/web posts on submission and apps/worker posts a crawl
 * summary, and a copy in each app is a copy that drifts. Pure string building
 * plus one fetch, no imports of its own.
 */
import { siteUrl } from '../email/urls'

// #region shape

/**
 * Which queue a notice belongs to. This is the "what the hell the thing is"
 * part of the embed, and it decides the colour and the wording.
 */
export type ApprovalVertical =
  | 'tool'
  | 'robot_code'
  | 'album'
  | 'field'
  | 'field_edit'
  | 'event'
  | 'grant'
  | 'claim'
  | 'crawl'

/** One "name: value" row in the embed. A blank value is dropped, not sent. */
export interface ApprovalFact {
  label: string
  value: string | number | null | undefined
  inline?: boolean
}

export interface ApprovalNotice {
  vertical: ApprovalVertical
  /**
   * What arrived, in the words a moderator would use to recognise it. Goes in
   * the embed title after the vertical's own label.
   */
  title: string
  /**
   * Where a moderator goes to decide, ABSOLUTE and pointing at the row itself
   * rather than at the queue index. Build it with one of the reviewUrl helpers
   * below so the anchors stay in step with the admin pages.
   */
  reviewUrl: string
  /** The thing that was submitted, when it is a URL a reviewer would open. */
  sourceUrl?: string | null
  /** The facts the decision actually turns on, in the order they matter. */
  facts?: ApprovalFact[]
  /** Who sent it in, when we know. Anonymous submission is normal, not an error. */
  submitter?: string | null
  /** A preview image: an album cover, an uploaded field photo. */
  imageUrl?: string | null
  /**
   * Overrides the default "Waiting for review" line. Used by the crawl summary,
   * which is a report on a run rather than one thing to approve.
   */
  description?: string | null
}

/** The Discord embed we build. Exported so it can be asserted in a test. */
export interface DiscordEmbed {
  title: string
  url?: string
  description: string
  color: number
  fields: Array<{ name: string; value: string; inline: boolean }>
  image?: { url: string }
  footer: { text: string }
  timestamp: string
}

// #endregion

// #region vocabulary

/** What each vertical is called in the embed title. */
const VERTICAL_LABEL: Record<ApprovalVertical, string> = {
  tool: 'Tool submission',
  robot_code: 'Robot code / CAD submission',
  album: 'Photo album submission',
  field: 'Practice field submission',
  field_edit: 'Practice field edit',
  event: 'Off-season event submission',
  grant: 'Grant submission',
  claim: 'Listing claim',
  crawl: 'Crawl run',
}

/**
 * One colour per vertical, so the queue a message belongs to is readable from
 * the stripe down the side before any of the words are.
 */
const VERTICAL_COLOR: Record<ApprovalVertical, number> = {
  tool: 0x6366f1,
  robot_code: 0x0ea5e9,
  album: 0x7c3aed,
  field: 0x22c55e,
  field_edit: 0xf59e0b,
  event: 0xec4899,
  grant: 0xeab308,
  claim: 0xef4444,
  crawl: 0x64748b,
}

// #endregion

// #region review links
//
// Every admin queue, as a link to ONE ROW. The pages render each row with an
// `id` matching the anchor built here, so the browser scrolls to the thing
// being decided rather than dropping the reviewer at the top of a list of
// thirty. Keep the two in step: an anchor changed on one side and not the
// other degrades to the top of the right page, which is the safe failure.

function admin(path: string): string {
  return `${siteUrl()}${path}`
}

export function reviewFieldUrl(fieldId: string): string {
  return admin(`/admin/practice-fields?status=pending#field-${fieldId}`)
}

export function reviewFieldEditUrl(proposalId: string): string {
  return admin(`/admin/field-edits#proposal-${proposalId}`)
}

export function reviewEventUrl(listingId: string): string {
  return admin(`/admin/event-listings?status=pending#event-${listingId}`)
}

export function reviewAlbumUrl(candidateId: string): string {
  return admin(`/admin/album-candidates?status=submitted#album-${candidateId}`)
}

export function reviewGrantUrl(candidateId: string): string {
  return admin(`/admin/grants/candidates?status=pending#grant-${candidateId}`)
}

/**
 * A tool or robot-code submission, before the worker has made a candidate of
 * it. The submissions queue is the only place it exists at that point.
 */
export function reviewSubmissionUrl(submissionId: string): string {
  return admin(`/admin/submissions?status=pending#submission-${submissionId}`)
}

/** A crawl candidate that already has its own page. */
export function reviewCandidateUrl(candidateId: string): string {
  return admin(`/admin/candidates/${candidateId}`)
}

export function reviewClaimUrl(claimId: string): string {
  return admin(`/admin/claims#claim-${claimId}`)
}

/** A whole queue, for the crawl summaries. A run is not one row. */
export function reviewQueueUrl(path: string): string {
  return admin(path)
}

// #endregion

// #region building

/** Discord's per-field value cap. Longer values are cut, never dropped. */
const FIELD_VALUE_MAX = 1024
const TITLE_MAX = 240

function clean(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text.slice(0, FIELD_VALUE_MAX) : null
}

/**
 * The embed, from a notice. Pure, so a test can assert what a moderator will
 * see without a webhook, and so the sample in a report is the real thing.
 */
export function buildApprovalEmbed(notice: ApprovalNotice): DiscordEmbed {
  const fields: DiscordEmbed['fields'] = []
  for (const fact of notice.facts ?? []) {
    const value = clean(fact.value)
    if (value) fields.push({ name: fact.label, value, inline: fact.inline ?? false })
  }

  const source = clean(notice.sourceUrl)
  if (source) fields.push({ name: 'Link', value: source, inline: false })

  // Anonymous is the normal case on every public form here, so it is STATED
  // rather than left off: a missing row reads as a bug, "Anonymous" does not.
  // A crawl run has no submitter and is not asked the question.
  if (notice.vertical !== 'crawl') {
    fields.push({
      name: 'Submitted by',
      value: clean(notice.submitter) ?? 'Anonymous (no account)',
      inline: false,
    })
  }

  const title = `${VERTICAL_LABEL[notice.vertical]}: ${clean(notice.title) ?? 'untitled'}`.slice(
    0,
    TITLE_MAX,
  )

  return {
    title,
    // The TITLE is the link, and it goes to the approval row. Whoever opens
    // this on a phone taps the heading, not a word buried in a sentence.
    url: notice.reviewUrl,
    description: notice.description ?? `Nothing is public until it is approved. [Open the review row](${notice.reviewUrl})`,
    color: VERTICAL_COLOR[notice.vertical],
    fields,
    ...(clean(notice.imageUrl) ? { image: { url: notice.imageUrl as string } } : {}),
    footer: { text: 'The Tool Pit' },
    timestamp: new Date().toISOString(),
  }
}

// #endregion

// #region posting
//
// `console` and `fetch` are reached off globalThis for the same reason
// email/urls.ts reads process.env that way: this package carries neither
// @types/node nor the DOM lib, on purpose, because it is imported by a Node
// worker AND by Next server components AND by client components, and pulling
// either type surface in here to name two globals is not a trade worth making.
// Both exist in every runtime this runs on (Node 18+, Bun, the browser).

interface HttpResponse {
  ok: boolean
  status: number
  statusText: string
  text(): Promise<string>
}

const g = globalThis as {
  process?: { env?: Record<string, string | undefined> }
  console?: { warn(...a: unknown[]): void; error(...a: unknown[]): void }
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<HttpResponse>
}

function warn(message: string): void {
  g.console?.warn(message)
}

function fail(message: string): void {
  g.console?.error(message)
}

/** The environment variable the webhook still lives under. See the file header. */
export const APPROVAL_WEBHOOK_ENV = 'FIELD_SUBMISSION_DISCORD_WEBHOOK'

export type PostOutcome = 'sent' | 'skipped' | 'failed'

function webhookUrl(): string | undefined {
  return g.process?.env?.[APPROVAL_WEBHOOK_ENV]
}

/**
 * Post one notice. Never throws; ALWAYS says something when it does not work.
 *
 * The return value is for tests and for a caller that wants to log more. The
 * important output is the console line: a webhook Discord has deleted answers
 * 401/404 with a JSON body naming the problem, and printing that body is the
 * difference between "notifications stopped months ago" and one grep.
 */
export async function postApprovalNotice(notice: ApprovalNotice): Promise<PostOutcome> {
  const webhook = webhookUrl()
  if (!webhook) {
    warn(`[discord] ${notice.vertical} notice not sent: ${APPROVAL_WEBHOOK_ENV} is unset. ${notice.reviewUrl}`)
    return 'skipped'
  }
  if (!g.fetch) {
    warn(`[discord] ${notice.vertical} notice not sent: no fetch in this runtime.`)
    return 'skipped'
  }

  const embed = buildApprovalEmbed(notice)
  try {
    const res = await g.fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    })
    if (res.ok) return 'sent'

    // Read the body before giving up on it. Discord puts the reason in there
    // and nowhere else: code 10015 is "Unknown Webhook", which means the URL in
    // the environment has been deleted and every notice since then was lost.
    let body = ''
    try {
      body = (await res.text()).slice(0, 500)
    } catch {
      body = '<unreadable>'
    }
    fail(`[discord] ${notice.vertical} notice REJECTED: HTTP ${res.status} ${res.statusText} ${body}`)
    return 'failed'
  } catch (err) {
    fail(`[discord] ${notice.vertical} notice failed to send: ${(err as Error).message}`)
    return 'failed'
  }
}

/**
 * Fire a notice without waiting for it, and still hear about a failure.
 *
 * The replacement for `void notify(...)`. A submission response must not wait
 * on Discord, but "do not wait" is not the same as "do not look": the promise
 * is chained so a rejection cannot become an unhandled one, and
 * postApprovalNotice has already logged whatever went wrong.
 */
export function sendApprovalNotice(notice: ApprovalNotice): void {
  void postApprovalNotice(notice).catch((err: unknown) => {
    fail(`[discord] ${notice.vertical} notice threw: ${(err as Error).message}`)
  })
}

// #endregion
