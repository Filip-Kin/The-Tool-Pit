/**
 * The one Discord notifier.
 *
 * ONE CHANNEL FOR EVERYTHING THAT NEEDS A DECISION. There used to be five
 * near-identical notify.ts modules, one per vertical, each reading its own
 * environment variable and each posting its own hand-rolled embed. Two of those
 * variables were never set in production and one pointed at a webhook Discord
 * had deleted: it answered {"message":"Unknown Webhook","code":10015} to every
 * post and nobody found out, because the call site was `void notify(...)` and
 * the failure was swallowed by an empty catch.
 *
 * So: one destination, one embed shape, and a failure that says so.
 *
 * It is now posted by the FRC.Tools BOT rather than a webhook (the webhook is
 * still the fallback). The difference is that a bot's message has an id we
 * own: the post is seeded with ✅ ❌, a developer decides by reacting, and the
 * post is edited to say who decided. See `#region posting` and `#region
 * deciding` below, discord_approval_messages in @the-tool-pit/db, and the
 * reaction listener in apps/worker/src/discord/listener.ts.
 *
 *   - A post that fails LOGS THE STATUS AND THE BODY. Discord puts the reason
 *     in the JSON error and nowhere else.
 *   - It still never throws. A submission must not fail because Discord is
 *     having a day, so callers may keep firing this without awaiting it. But
 *     they must not silence it: the log line is the whole point.
 *
 * Lives in @the-tool-pit/types, beside the email templates, for the same
 * reason they do: apps/web posts on submission and apps/worker posts a crawl
 * summary, and a copy in each app is a copy that drifts. Pure string building
 * plus fetch, no imports of its own.
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
  | 'event_edit'
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
  /**
   * A system alert, not something a person sent in: no vertical prefix on the
   * title and no "Submitted by" row. A failed team-list read is an alert.
   */
  alert?: boolean
  /**
   * The row a ✅ or ❌ on this message decides. Which table it names is fixed
   * by the vertical (see discord_approval_messages in @the-tool-pit/db).
   *
   * LEAVE IT OFF when there is nothing to one-click: a crawl summary, a parser
   * failure, a grant (which is published from a corrected editor form, never
   * as-is). A notice without one is posted and gets no reactions, so the
   * channel itself says which posts are decisions.
   */
  entityId?: string | null
}

/** The Discord embed we build. Exported so it can be asserted in a test. */
export interface DiscordEmbed {
  title: string
  url?: string
  description?: string
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
  event_edit: 'Off-season event edit',
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
  event_edit: 0xf59e0b,
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

export function reviewEventEditUrl(proposalId: string): string {
  return admin(`/admin/event-edits#proposal-${proposalId}`)
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
  if (notice.vertical !== 'crawl' && !notice.alert) {
    fields.push({
      name: 'Submitted by',
      value: clean(notice.submitter) ?? 'Anonymous',
      inline: false,
    })
  }

  const title = (notice.alert ? clean(notice.title) ?? 'Alert' : `${VERTICAL_LABEL[notice.vertical]}: ${clean(notice.title) ?? 'untitled'}`).slice(
    0,
    TITLE_MAX,
  )

  return {
    title,
    // The TITLE is the link, and it goes to the approval row. Whoever opens
    // this on a phone taps the heading, not a word buried in a sentence.
    url: notice.reviewUrl,
    ...(notice.description ? { description: notice.description } : {}),
    color: VERTICAL_COLOR[notice.vertical],
    fields,
    ...(clean(notice.imageUrl) ? { image: { url: notice.imageUrl as string } } : {}),
    footer: { text: 'FRC.Tools' },
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
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>
}

function warn(message: string): void {
  g.console?.warn(message)
}

function fail(message: string): void {
  g.console?.error(message)
}

function env(name: string): string | undefined {
  const value = g.process?.env?.[name]?.trim()
  return value ? value : undefined
}

/**
 * TWO WAYS TO POST, IN ORDER OF PREFERENCE.
 *
 *   1. The FRC.Tools bot. DISCORD_BOT_TOKEN plus DISCORD_APPROVALS_CHANNEL_ID.
 *      The message is the bot's, so it comes back with an id we can react to,
 *      look up when somebody reacts, and edit when the row is decided. This
 *      is the whole approvals-by-reaction flow and it only exists on this path.
 *   2. The webhook, DISCORD_WEBHOOK (FIELD_SUBMISSION_DISCORD_WEBHOOK is still
 *      read as the legacy name). Fire and forget: no id comes back, so nothing
 *      downstream can act on the post. Kept so a box without the bot's
 *      variables still pings somebody rather than going quiet.
 *
 * The bot's variables must be set on BOTH the web and worker services. The
 * worker posts crawl summaries through here too, and it is also the process
 * that listens for the reactions.
 */
export const DISCORD_BOT_TOKEN_ENV = 'DISCORD_BOT_TOKEN'
export const DISCORD_APPROVALS_CHANNEL_ENV = 'DISCORD_APPROVALS_CHANNEL_ID'
export const DISCORD_WEBHOOK_ENV = 'DISCORD_WEBHOOK'
export const APPROVAL_WEBHOOK_ENV_LEGACY = 'FIELD_SUBMISSION_DISCORD_WEBHOOK'
/** @deprecated use DISCORD_WEBHOOK_ENV. Kept as an alias so existing imports compile. */
export const APPROVAL_WEBHOOK_ENV = DISCORD_WEBHOOK_ENV

export type PostOutcome = 'sent' | 'skipped' | 'failed'

export interface PostResult {
  outcome: PostOutcome
  /** Set only on the bot path: the message a reaction or an edit can target. */
  messageId?: string
  channelId?: string
}

function webhookUrl(): string | undefined {
  return env(DISCORD_WEBHOOK_ENV) ?? env(APPROVAL_WEBHOOK_ENV_LEGACY)
}

function botConfig(): { token: string; channelId: string } | null {
  const token = env(DISCORD_BOT_TOKEN_ENV)
  const channelId = env(DISCORD_APPROVALS_CHANNEL_ENV)
  return token && channelId ? { token, channelId } : null
}

const DISCORD_API = 'https://discord.com/api/v10'

/** The two reactions the bot seeds on a decidable post. What the worker listens for. */
export const APPROVE_EMOJI = '✅'
export const REJECT_EMOJI = '❌'

/**
 * One call against the Discord REST API as the bot. Returns the parsed JSON
 * body, or null after logging the failure: a rejected call is a log line, not
 * an exception, because nothing that calls this may fail a submission.
 */
export async function discordRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Record<string, unknown> | null> {
  const token = env(DISCORD_BOT_TOKEN_ENV)
  if (!token) {
    warn(`[discord] ${method} ${path} not sent: ${DISCORD_BOT_TOKEN_ENV} is unset.`)
    return null
  }
  if (!g.fetch) {
    warn(`[discord] ${method} ${path} not sent: no fetch in this runtime.`)
    return null
  }
  try {
    const res = await g.fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://frc.tools, 1.0)',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      fail(`[discord] ${method} ${path} REJECTED: HTTP ${res.status} ${res.statusText} ${text.slice(0, 500)}`)
      return null
    }
    // 204 on a reaction PUT/DELETE has no body. That is success, not nothing.
    if (!text) return {}
    return JSON.parse(text) as Record<string, unknown>
  } catch (err) {
    fail(`[discord] ${method} ${path} failed: ${(err as Error).message}`)
    return null
  }
}

async function addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  await discordRequest('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`)
}

/**
 * Post one notice. Never throws; ALWAYS says something when it does not work.
 *
 * Bot first, webhook second, see above. On the bot path a notice with an
 * entityId is seeded with ✅ and ❌ so the reviewer has nothing to type.
 *
 * The important output is still the console line: a webhook Discord has
 * deleted answers 401/404 with a JSON body naming the problem, and printing
 * that body is the difference between "notifications stopped months ago" and
 * one grep.
 */
export async function postApprovalMessage(notice: ApprovalNotice): Promise<PostResult> {
  const embed = buildApprovalEmbed(notice)

  const bot = botConfig()
  if (bot) {
    const posted = await discordRequest('POST', `/channels/${bot.channelId}/messages`, { embeds: [embed] })
    const messageId = typeof posted?.id === 'string' ? posted.id : undefined
    if (!messageId) return { outcome: 'failed' }
    if (notice.entityId) {
      await addReaction(bot.channelId, messageId, APPROVE_EMOJI)
      await addReaction(bot.channelId, messageId, REJECT_EMOJI)
    }
    return { outcome: 'sent', messageId, channelId: bot.channelId }
  }

  const webhook = webhookUrl()
  if (!webhook) {
    warn(
      `[discord] ${notice.vertical} notice not sent: neither ${DISCORD_BOT_TOKEN_ENV}+${DISCORD_APPROVALS_CHANNEL_ENV} nor ${DISCORD_WEBHOOK_ENV} is set. ${notice.reviewUrl}`,
    )
    return { outcome: 'skipped' }
  }
  if (!g.fetch) {
    warn(`[discord] ${notice.vertical} notice not sent: no fetch in this runtime.`)
    return { outcome: 'skipped' }
  }

  try {
    const res = await g.fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    })
    if (res.ok) return { outcome: 'sent' }

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
    return { outcome: 'failed' }
  } catch (err) {
    fail(`[discord] ${notice.vertical} notice failed to send: ${(err as Error).message}`)
    return { outcome: 'failed' }
  }
}

/** postApprovalMessage, outcome only. The shape every existing caller and test expects. */
export async function postApprovalNotice(notice: ApprovalNotice): Promise<PostOutcome> {
  return (await postApprovalMessage(notice)).outcome
}

/**
 * Fire a notice without waiting for it, and still hear about a failure.
 *
 * The replacement for `void notify(...)`. A submission response must not wait
 * on Discord, but "do not wait" is not the same as "do not look": the promise
 * is chained so a rejection cannot become an unhandled one, and
 * postApprovalMessage has already logged whatever went wrong.
 *
 * `onPosted` runs only when the bot path produced a message id. apps/web uses
 * it to write the discord_approval_messages row; this package has no database
 * and must not grow one.
 */
export function sendApprovalNotice(
  notice: ApprovalNotice,
  onPosted?: (posted: { messageId: string; channelId: string }) => Promise<void>,
): void {
  void postApprovalMessage(notice)
    .then(async (result) => {
      if (onPosted && result.messageId && result.channelId) {
        await onPosted({ messageId: result.messageId, channelId: result.channelId })
      }
    })
    .catch((err: unknown) => {
      fail(`[discord] ${notice.vertical} notice threw: ${(err as Error).message}`)
    })
}

// #endregion

// #region deciding
//
// The other half of owning the message: once the row is decided, from either
// side, the post says so. The channel then reads as a log rather than as a
// queue nobody cleared.

export interface ApprovalDecision {
  status: 'approved' | 'rejected'
  /** Display name. A Discord member or the site admin. */
  by: string
  via: 'discord' | 'site'
}

const DECIDED_COLOR: Record<ApprovalDecision['status'], number> = {
  approved: 0x22c55e,
  rejected: 0xef4444,
}

/**
 * The decided embed, from the one that was posted. Pure, so a test can assert
 * what the channel will show. The title keeps its link, the facts stay (they
 * are the record of what was decided), the stripe and the first line change.
 */
export function decideApprovalEmbed(embed: DiscordEmbed, decision: ApprovalDecision): DiscordEmbed {
  const bare = embed.title.replace(/^(✅|❌)\s+/u, '')
  const mark = decision.status === 'approved' ? APPROVE_EMOJI : REJECT_EMOJI
  const verb = decision.status === 'approved' ? 'Approved' : 'Rejected'
  const where = decision.via === 'discord' ? 'Discord' : 'Site'
  return {
    ...embed,
    title: `${mark} ${bare}`.slice(0, TITLE_MAX),
    color: DECIDED_COLOR[decision.status],
    description: `${verb} · ${decision.by} · ${where}`,
  }
}

/**
 * Rewrite a posted notice as decided and clear its reactions. Never throws;
 * a message that can no longer be edited (deleted by hand, channel gone) is a
 * log line, because the decision it describes has already happened.
 */
export async function editApprovalMessage(
  channelId: string,
  messageId: string,
  decision: ApprovalDecision,
): Promise<boolean> {
  const current = await discordRequest('GET', `/channels/${channelId}/messages/${messageId}`)
  const embeds = Array.isArray(current?.embeds) ? (current!.embeds as DiscordEmbed[]) : []
  const embed = embeds[0]
  if (!embed) {
    fail(`[discord] message ${messageId} has no embed to mark ${decision.status}`)
    return false
  }
  const patched = await discordRequest('PATCH', `/channels/${channelId}/messages/${messageId}`, {
    embeds: [decideApprovalEmbed(embed, decision)],
  })
  if (!patched) return false
  // Reactions off, so a late ✅ has nothing to land on. Manage Messages.
  await discordRequest('DELETE', `/channels/${channelId}/messages/${messageId}/reactions`)
  return true
}

// #endregion
