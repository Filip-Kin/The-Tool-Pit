'use server'

import Anthropic from '@anthropic-ai/sdk'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, sql, and, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  tools,
  toolLinks,
  toolPrograms,
  toolAudiencePrimaryRoles,
  toolAudienceFunctions,
  toolVotes,
  crawlCandidates,
} from '@the-tool-pit/db'

async function assertAdmin() {
  const cookieStore = await cookies()
  const authed = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET
  if (!authed) redirect('/admin/login')
}

export interface DupeTool {
  id: string
  name: string
  slug: string
  publishedAt: Date | null
  votes: number
  homepageUrl: string | null
}

export interface DupeGroup {
  method: 'url' | 'name'
  tools: DupeTool[]
}

/** Union-find: merges pairwise edges into clusters of IDs. */
function clusterPairs(pairs: { a: string; b: string }[]): string[][] {
  const parent = new Map<string, string>()
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    const p = parent.get(x)!
    if (p !== x) { const root = find(p); parent.set(x, root); return root }
    return x
  }
  function union(x: string, y: string) { parent.set(find(x), find(y)) }
  for (const { a, b } of pairs) union(a, b)
  const clusters = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(id)
  }
  return [...clusters.values()].filter((c) => c.length > 1)
}

/** Scan for duplicate published tools. Returns groups of 2+ tools that appear to be duplicates. */
export async function scanDuplicates(): Promise<{ error?: string; groups?: DupeGroup[] }> {
  await assertAdmin()
  const db = getDb()

  try {
    // ── URL duplicates: fetch all published homepage URLs, group in JS ──
    const urlRows = await db.execute<{ url: string; tool_id: string }>(sql`
      SELECT tl.url, tl.tool_id
      FROM tool_links tl
      JOIN tools t ON t.id = tl.tool_id AND t.status = 'published'
      WHERE tl.link_type = 'homepage'
    `)

    const byUrl = new Map<string, string[]>()
    for (const row of urlRows) {
      if (!byUrl.has(row.url)) byUrl.set(row.url, [])
      byUrl.get(row.url)!.push(row.tool_id)
    }
    const urlClusters: string[][] = [...byUrl.values()].filter((ids) => ids.length > 1)

    // ── Name duplicates: pairwise similarity, then cluster transitively ──
    const namePairs = await db.execute<{ tool_id_a: string; tool_id_b: string }>(sql`
      SELECT a.id AS tool_id_a, b.id AS tool_id_b
      FROM tools a
      JOIN tools b
        ON similarity(a.name, b.name) > 0.85
       AND a.id < b.id
      WHERE a.status = 'published'
        AND b.status = 'published'
    `)
    const nameClusters = clusterPairs(
      namePairs.map((r) => ({ a: r.tool_id_a, b: r.tool_id_b })),
    )

    // Collect all unique tool IDs
    const allIds = new Set<string>()
    const rawGroups: { method: 'url' | 'name'; ids: string[] }[] = []

    for (const ids of urlClusters) {
      for (const id of ids) allIds.add(id)
      rawGroups.push({ method: 'url', ids })
    }
    // Only add name clusters not already fully covered by a URL cluster
    const urlIdSets = urlClusters.map((ids) => new Set(ids))
    for (const ids of nameClusters) {
      const idSet = new Set(ids)
      const alreadyCovered = urlIdSets.some((s) => ids.every((id) => s.has(id)))
      if (!alreadyCovered) {
        for (const id of ids) allIds.add(id)
        rawGroups.push({ method: 'name', ids })
      }
    }

    if (allIds.size === 0) return { groups: [] }

    // Fetch tool details + homepage URLs + vote counts for all involved tools
    const idList = [...allIds]
    const toolRows = await db
      .select({
        id: tools.id,
        name: tools.name,
        slug: tools.slug,
        publishedAt: tools.publishedAt,
      })
      .from(tools)
      .where(inArray(tools.id, idList))

    const linkRows = await db
      .select({ toolId: toolLinks.toolId, url: toolLinks.url })
      .from(toolLinks)
      .where(and(inArray(toolLinks.toolId, idList), eq(toolLinks.linkType, 'homepage')))

    const voteRows = await db
      .select({ toolId: toolVotes.toolId, cnt: sql<number>`count(*)::int` })
      .from(toolVotes)
      .where(inArray(toolVotes.toolId, idList))
      .groupBy(toolVotes.toolId)

    const toolMap = new Map<string, DupeTool>()
    for (const t of toolRows) {
      toolMap.set(t.id, { ...t, votes: 0, homepageUrl: null })
    }
    for (const l of linkRows) {
      const t = toolMap.get(l.toolId)
      if (t) t.homepageUrl = l.url
    }
    for (const v of voteRows) {
      const t = toolMap.get(v.toolId)
      if (t) t.votes = v.cnt
    }

    const groups: DupeGroup[] = rawGroups
      .map(({ method, ids }) => {
        const groupTools = ids.map((id) => toolMap.get(id)).filter((t): t is DupeTool => !!t)
        if (groupTools.length < 2) return null
        // Sort oldest first so the default canonical is the first entry
        groupTools.sort(
          (a, b) =>
            (a.publishedAt ? new Date(a.publishedAt).getTime() : Infinity) -
            (b.publishedAt ? new Date(b.publishedAt).getTime() : Infinity),
        )
        return { method, tools: groupTools }
      })
      .filter((g): g is DupeGroup => g !== null)

    return { groups }
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * Merge one or more duplicates into `canonicalId`:
 * - Re-points all FK child records to canonicalId
 * - Suppresses each duplicate tool
 */
export async function mergeDuplicate(
  canonicalId: string,
  duplicateIds: string[],
): Promise<{ error?: string }> {
  await assertAdmin()

  const ids = duplicateIds.filter((id) => id !== canonicalId)
  if (ids.length === 0) return { error: 'No valid duplicates to merge' }

  const db = getDb()

  try {
    await db.transaction(async (tx) => {
      for (const duplicateId of ids) {
        // Re-point votes — delete conflicting rows first (same voter already voted on canonical)
        await tx.execute(sql`
          DELETE FROM tool_votes
          WHERE tool_id = ${duplicateId}
            AND voter_fingerprint IN (
              SELECT voter_fingerprint FROM tool_votes WHERE tool_id = ${canonicalId}
            )
        `)
        await tx.execute(sql`
          UPDATE tool_votes SET tool_id = ${canonicalId}
          WHERE tool_id = ${duplicateId}
        `)

        // Re-point click events
        await tx.execute(sql`
          UPDATE tool_click_events SET tool_id = ${canonicalId}
          WHERE tool_id = ${duplicateId}
        `)

        // Re-point sources
        await tx.execute(sql`
          UPDATE tool_sources SET tool_id = ${canonicalId}
          WHERE tool_id = ${duplicateId}
        `)

        // Re-point freshness update signals
        await tx.execute(sql`
          UPDATE tool_updates SET tool_id = ${canonicalId}
          WHERE tool_id = ${duplicateId}
        `)

        // Re-point candidates
        await tx.execute(sql`
          UPDATE crawl_candidates SET matched_tool_id = ${canonicalId}
          WHERE matched_tool_id = ${duplicateId}
        `)

        // Merge junction tables (ignore conflicts — canonical may already have the row)
        await tx.execute(sql`
          INSERT INTO tool_programs (tool_id, program_id)
          SELECT ${canonicalId}, program_id FROM tool_programs WHERE tool_id = ${duplicateId}
          ON CONFLICT DO NOTHING
        `)
        await tx.execute(sql`
          INSERT INTO tool_audience_primary_roles (tool_id, role_id)
          SELECT ${canonicalId}, role_id FROM tool_audience_primary_roles WHERE tool_id = ${duplicateId}
          ON CONFLICT DO NOTHING
        `)
        await tx.execute(sql`
          INSERT INTO tool_audience_functions (tool_id, function_id)
          SELECT ${canonicalId}, function_id FROM tool_audience_functions WHERE tool_id = ${duplicateId}
          ON CONFLICT DO NOTHING
        `)

        // Merge links: copy any link types the canonical doesn't already have
        await tx.execute(sql`
          INSERT INTO tool_links (tool_id, link_type, url)
          SELECT ${canonicalId}, link_type, url FROM tool_links
          WHERE tool_id = ${duplicateId}
            AND link_type NOT IN (
              SELECT link_type FROM tool_links WHERE tool_id = ${canonicalId}
            )
          ON CONFLICT DO NOTHING
        `)

        // Suppress the duplicate
        await tx
          .update(tools)
          .set({
            status: 'suppressed',
            adminNotes: `Merged into ${canonicalId} by dedup tool`,
            updatedAt: new Date(),
          })
          .where(eq(tools.id, duplicateId))
      }
    })

    revalidatePath('/admin/tools')
    revalidatePath('/admin/maintenance')
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * Use Claude to pick the best canonical tool to keep in each duplicate group.
 * Returns a map of groupIndex → tool ID that should be kept.
 */
export async function resolveWithAI(
  groups: DupeGroup[],
): Promise<{ error?: string; selections?: Record<number, string> }> {
  await assertAdmin()

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'ANTHROPIC_API_KEY is not configured' }
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const groupSummaries = groups.map((g, i) => {
    const tools = g.tools
      .map(
        (t) =>
          `  - id: "${t.id}", name: "${t.name}", url: "${t.homepageUrl ?? 'none'}", votes: ${t.votes}, published: "${t.publishedAt ? new Date(t.publishedAt).toISOString().slice(0, 10) : 'unknown'}"`,
      )
      .join('\n')
    return `Group ${i} (match: ${g.method}):\n${tools}`
  })

  const prompt = `You are helping an admin clean up a FIRST Robotics tools directory.
The following are groups of duplicate tools. For each group, choose the single best tool ID to keep as the canonical entry.

Prefer the tool that:
1. Has the most votes (most community engagement)
2. Was published earliest (original entry)
3. Has the most descriptive/accurate name

Return ONLY a JSON object mapping group index (as a string key) to the tool ID to keep.
Example: {"0": "uuid-a", "1": "uuid-b"}

Groups:
${groupSummaries.join('\n\n')}`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: `AI returned an unexpected response: ${JSON.stringify(text.slice(0, 500))}` }

    const raw = JSON.parse(jsonMatch[0]) as Record<string, string>

    // Validate: every returned ID must belong to the stated group
    const selections: Record<number, string> = {}
    for (const [key, id] of Object.entries(raw)) {
      const idx = parseInt(key, 10)
      if (isNaN(idx) || idx < 0 || idx >= groups.length) continue
      const valid = groups[idx]?.tools.some((t) => t.id === id)
      if (valid) selections[idx] = id
    }

    // Fill any groups the AI missed with the first tool (oldest)
    for (let i = 0; i < groups.length; i++) {
      if (!selections[i]) selections[i] = groups[i]!.tools[0]!.id
    }

    return { selections }
  } catch (err) {
    return { error: String(err) }
  }
}
