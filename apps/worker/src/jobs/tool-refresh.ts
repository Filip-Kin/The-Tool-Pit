/**
 * Monthly homepage refresh for tools that have no GitHub repo.
 *
 * freshness.ts, popularity.ts and link-checker.ts keep a repo-backed listing
 * current. A listing whose only link is a homepage was read once, on intake,
 * and never again: a site that renamed itself kept its old name here, and a
 * site that died stayed listed. This pass re-reads each of those homepages
 * once a month, with the crawler's own extractor, and:
 *
 * - applies a changed name or description (rules in tool-refresh-rules.ts:
 *   only what changed on the page since last month, never a claimed field,
 *   never to empty, never a generic or parking-page name);
 * - suppresses a listing whose homepage was gone (404/410, DNS failure, a
 *   parking or suspended page) on two consecutive monthly runs. One run only
 *   records a strike. A wall (401/403/429/503 still refused through the NAS
 *   relay) is a live site we cannot read, never a dead one;
 * - skips a page whose text hash has not moved since last month;
 * - posts one Discord summary for the run, and nothing when nothing changed.
 *
 * ONE SWEEP JOB, like popularity.ts, so the run has one place to pace its
 * requests and one place to collect the summary. Concurrency is a small pool
 * inside the job, with a pause after every read.
 *
 * State lives in Redis, per tool: last month's read of the page (the baseline
 * the next run compares against), its text hash, and an open strike.
 */
import { lookup } from 'node:dns/promises'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, tools, toolLinks, isHumanEdited } from '@the-tool-pit/db'
import { sendApprovalNotice, reviewQueueUrl } from '@the-tool-pit/types'
import { politeFetch, delay } from '../connectors/base.js'
import { parseGitHubUrl } from '../connectors/github.js'
import { fetchWithRelayFallback } from '../grants/relay-fetch.js'
import { extractHtmlMetadata, isYouTubeUrl } from '../pipeline/extract.js'
import { getRedis } from '../redis.js'
import { applyLoggedPatch } from '../listings/change-log.js'
import {
  fetchVerdict,
  monthKey,
  pageHash,
  planToolUpdate,
  runFacts,
  strikeDecision,
  type FetchVerdict,
  type PageSnapshot,
  type Strike,
  type ToolRunResult,
} from './tool-refresh-rules.js'

export interface ToolRefreshPayload {
  /** Refresh one listing instead of every eligible one. For a manual re-check. */
  toolId?: string
}

/** Homepages read at once. Small: these are other people's servers. */
const POOL = 3
/** Pause after every read, per pool slot. */
const PAUSE_MS = 1500

const KEY = {
  snapshot: (id: string) => `tool-refresh:snapshot:${id}`,
  hash: (id: string) => `tool-refresh:hash:${id}`,
  strike: (id: string) => `tool-refresh:strike:${id}`,
}
/** Baselines outlive a skipped month or two; strikes only need to reach the next run. */
const SNAPSHOT_TTL_S = 400 * 24 * 3600
const STRIKE_TTL_S = 100 * 24 * 3600

const HTMLISH = /html|xml|text\/plain/i

interface EligibleTool {
  id: string
  slug: string
  name: string
  summary: string | null
  description: string | null
  adminNotes: string | null
  humanEditedFields: string[]
  url: string
}

interface PageRead {
  verdict: FetchVerdict
  snapshot?: PageSnapshot
  hash?: string
}

// #region reading

/** True only when the host itself does not resolve. A timeout or EAI_AGAIN is not this. */
async function hostMissing(url: string): Promise<boolean> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  try {
    await lookup(host)
    return false
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'ENOTFOUND' || code === 'ENODATA'
  }
}

async function readHomepage(url: string): Promise<PageRead> {
  let outcome: Awaited<ReturnType<typeof fetchWithRelayFallback>>
  try {
    outcome = await fetchWithRelayFallback(url, () => politeFetch(url, { redirect: 'follow' }))
  } catch (err) {
    const error = String(err).split('\n')[0] ?? 'fetch failed'
    return { verdict: fetchVerdict({ dnsFailed: await hostMissing(url), error }) }
  }

  const { res } = outcome
  const contentType = res.headers.get('content-type') ?? ''
  const finalUrl = res.url || url
  if (!res.ok || (contentType && !HTMLISH.test(contentType))) {
    // A non-HTML 200 (a PDF homepage) has nothing to extract and is not dead.
    const status = res.ok ? null : res.status
    return { verdict: status == null ? { kind: 'unknown', reason: `content-type ${contentType}` } : fetchVerdict({ status, refusal: outcome.refusal, finalUrl }) }
  }

  const html = await res.text()
  // The same extractor the crawler used on intake, against the stored URL, so
  // productTitle sees the same path it saw then.
  const meta = extractHtmlMetadata(html, url)
  const title = meta.title ?? ''
  const description = meta.description ?? ''
  const text = meta.rawHtml ?? ''
  const verdict = fetchVerdict({
    status: res.status,
    // The relay's own answer is real; only an unrelieved direct refusal is a wall.
    refusal: outcome.via === 'direct' ? outcome.refusal : null,
    title,
    text,
    finalUrl,
  })
  return {
    verdict,
    snapshot: { name: title, description },
    hash: pageHash({ title, description, text }),
  }
}

// #endregion

// #region writing

/** Columns this job writes, guarded in SQL as well, against a claim made mid-run. */
function notClaimed(keys: string[]) {
  return sql`not (${tools.humanEditedFields} && ARRAY[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[])`
}

async function suppressTool(tool: EligibleTool, strikes: [Strike, Strike]): Promise<boolean> {
  const line = `Suppressed: homepage gone (${strikes[0].month} ${strikes[0].reason}; ${strikes[1].month} ${strikes[1].reason})`
  // Appended, never replaced: a moderator's note stays readable above it.
  const notes = [tool.adminNotes, line].filter(Boolean).join('\n')
  const done = await applyLoggedPatch({
    entityType: 'tool',
    table: tools,
    id: tool.id,
    actor: 'tool-refresh',
    patch: { status: 'suppressed', adminNotes: notes },
    proof: { status: { quote: line, source: tool.url } },
    where: and(eq(tools.status, 'published'), notClaimed(['status'])),
  })
  return done.length > 0
}

// #endregion

async function refreshTool(tool: EligibleTool, month: string): Promise<ToolRunResult | null> {
  const redis = getRedis()
  const read = await readHomepage(tool.url)
  const { verdict } = read

  if (verdict.kind === 'dead') {
    const raw = await redis.get(KEY.strike(tool.id))
    const prev = raw ? (JSON.parse(raw) as Strike) : null
    const decision = strikeDecision(prev, month, verdict.reason)
    if (decision.action === 'suppress' && prev) {
      if (isHumanEdited(tool.humanEditedFields, 'status')) {
        console.log(`[tool-refresh] ${tool.slug}: site gone twice (${verdict.reason}), kept: status set by hand`)
        await redis.set(KEY.strike(tool.id), JSON.stringify(decision.strike), 'EX', STRIKE_TTL_S)
        return null
      }
      const suppressed = await suppressTool(tool, [prev, decision.strike])
      await redis.del(KEY.strike(tool.id), KEY.snapshot(tool.id), KEY.hash(tool.id))
      console.log(`[tool-refresh] ${tool.slug}: ${suppressed ? 'suppressed' : 'not suppressed (row moved)'}, site gone twice (${prev.reason}; ${verdict.reason})`)
      return suppressed ? { name: tool.name, changes: [], suppressed: { reason: verdict.reason } } : null
    }
    await redis.set(KEY.strike(tool.id), JSON.stringify(decision.strike), 'EX', STRIKE_TTL_S)
    console.log(`[tool-refresh] ${tool.slug}: strike, ${verdict.reason} (${tool.url})`)
    return null
  }

  if (verdict.kind !== 'ok' || !read.snapshot || !read.hash) {
    // A wall or a bad night. Not evidence of anything; any strike stays as it was.
    console.log(`[tool-refresh] ${tool.slug}: not read, ${verdict.kind === 'ok' ? 'no page' : verdict.reason}`)
    return null
  }

  // Alive: any open strike is over.
  await redis.del(KEY.strike(tool.id))

  const lastHash = await redis.get(KEY.hash(tool.id))
  if (lastHash === read.hash) return null

  const rawSnap = await redis.get(KEY.snapshot(tool.id))
  const prev = rawSnap ? (JSON.parse(rawSnap) as PageSnapshot) : null
  const plan = planToolUpdate(tool, prev, read.snapshot)

  let applied = plan.changes
  if (plan.changes.length > 0) {
    const keys = Object.keys(plan.set)
    // Old values to listing_changes and the write, in one transaction.
    const done = await applyLoggedPatch({
      entityType: 'tool',
      table: tools,
      id: tool.id,
      actor: 'tool-refresh',
      patch: plan.set,
      proof: Object.fromEntries(keys.map((k) => [k, { quote: null, source: tool.url }])),
      where: and(eq(tools.status, 'published'), notClaimed(keys)),
    })
    if (done.length === 0) applied = []
  }

  await redis.set(KEY.snapshot(tool.id), JSON.stringify(read.snapshot), 'EX', SNAPSHOT_TTL_S)
  await redis.set(KEY.hash(tool.id), read.hash, 'EX', SNAPSHOT_TTL_S)

  if (applied.length === 0) {
    if (!prev) console.log(`[tool-refresh] ${tool.slug}: baseline recorded`)
    return null
  }
  console.log(`[tool-refresh] ${tool.slug}: updated ${applied.map((c) => c.field).join(', ')}`)
  return { name: tool.name, changes: applied }
}

async function eligibleTools(toolId?: string): Promise<EligibleTool[]> {
  const rows = await getDb()
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      summary: tools.summary,
      description: tools.description,
      adminNotes: tools.adminNotes,
      humanEditedFields: tools.humanEditedFields,
      url: toolLinks.url,
    })
    .from(tools)
    .innerJoin(toolLinks, and(eq(toolLinks.toolId, tools.id), eq(toolLinks.linkType, 'homepage')))
    .where(
      and(
        eq(tools.status, 'published'),
        toolId ? eq(tools.id, toolId) : undefined,
        sql`not exists (select 1 from tool_links g where g.tool_id = ${tools.id} and g.link_type = 'github')`,
      ),
    )
    .orderBy(tools.id, toolLinks.createdAt)

  const seen = new Set<string>()
  const out: EligibleTool[] = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    // A repo or a video is not a site to re-read; the GitHub jobs and the
    // YouTube API own those.
    if (!/^https?:\/\//i.test(r.url) || parseGitHubUrl(r.url) || isYouTubeUrl(r.url)) continue
    out.push(r)
  }
  return out
}

export async function processToolRefreshJob(payload: ToolRefreshPayload = {}, now = new Date()): Promise<ToolRunResult[]> {
  const month = monthKey(now)
  const queue = await eligibleTools(payload.toolId)
  console.log(`[tool-refresh] ${queue.length} homepage-only tools to read (${month})`)

  const results: ToolRunResult[] = []
  let next = 0
  const slot = async () => {
    while (next < queue.length) {
      const tool = queue[next++]!
      try {
        const r = await refreshTool(tool, month)
        if (r) results.push(r)
      } catch (err) {
        console.error(`[tool-refresh] ${tool.slug}: ${(err as Error).message}`)
      }
      await delay(PAUSE_MS)
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, queue.length) }, slot))

  if (results.length > 0) {
    sendApprovalNotice({
      vertical: 'tool',
      alert: true,
      title: `Tools updated: ${results.length}`,
      reviewUrl: reviewQueueUrl('/admin/tools'),
      facts: runFacts(results),
    })
  }
  console.log(`[tool-refresh] done: ${results.filter((r) => r.suppressed).length} suppressed, ${results.filter((r) => !r.suppressed).length} updated`)
  return results
}
