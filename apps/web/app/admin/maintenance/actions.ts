'use server'

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

/** Scan for duplicate published tools. Returns groups of 2+ tools that appear to be duplicates. */
export async function scanDuplicates(): Promise<{ error?: string; groups?: DupeGroup[] }> {
  await assertAdmin()
  const db = getDb()

  try {
    // ── URL duplicates: multiple published tools sharing the same homepage URL ──
    const urlDupePairs = await db.execute<{ tool_id_a: string; tool_id_b: string }>(sql`
      SELECT a.tool_id AS tool_id_a, b.tool_id AS tool_id_b
      FROM tool_links a
      JOIN tool_links b
        ON a.url = b.url
       AND a.tool_id < b.tool_id
       AND a.link_type = 'homepage'
       AND b.link_type = 'homepage'
      JOIN tools ta ON ta.id = a.tool_id AND ta.status = 'published'
      JOIN tools tb ON tb.id = b.tool_id AND tb.status = 'published'
    `)

    // ── Name duplicates: published tools with very similar names ──
    const nameDupePairs = await db.execute<{ tool_id_a: string; tool_id_b: string }>(sql`
      SELECT a.id AS tool_id_a, b.id AS tool_id_b
      FROM tools a
      JOIN tools b
        ON similarity(a.name, b.name) > 0.85
       AND a.id < b.id
      WHERE a.status = 'published'
        AND b.status = 'published'
    `)

    // Collect all unique tool IDs across all pairs
    const allIds = new Set<string>()
    const allPairs: { a: string; b: string; method: 'url' | 'name' }[] = []

    for (const row of urlDupePairs) {
      allIds.add(row.tool_id_a)
      allIds.add(row.tool_id_b)
      allPairs.push({ a: row.tool_id_a, b: row.tool_id_b, method: 'url' })
    }
    for (const row of nameDupePairs) {
      allIds.add(row.tool_id_a)
      allIds.add(row.tool_id_b)
      // Skip if already captured as a URL dupe
      const existing = allPairs.find(
        (p) =>
          (p.a === row.tool_id_a && p.b === row.tool_id_b) ||
          (p.a === row.tool_id_b && p.b === row.tool_id_a),
      )
      if (!existing) allPairs.push({ a: row.tool_id_a, b: row.tool_id_b, method: 'name' })
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

    // Build groups: for each pair, group into a DupeGroup
    // Simple pairwise output — each pair becomes its own group
    const groups: DupeGroup[] = allPairs
      .map(({ a, b, method }) => {
        const toolA = toolMap.get(a)
        const toolB = toolMap.get(b)
        if (!toolA || !toolB) return null
        return { method, tools: [toolA, toolB] }
      })
      .filter((g): g is DupeGroup => g !== null)

    return { groups }
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * Merge `duplicateId` into `canonicalId`:
 * - Re-points all FK child records to canonicalId
 * - Suppresses the duplicate tool
 */
export async function mergeDuplicate(
  canonicalId: string,
  duplicateId: string,
): Promise<{ error?: string }> {
  await assertAdmin()

  if (canonicalId === duplicateId) return { error: 'canonical and duplicate must differ' }

  const db = getDb()

  try {
    await db.transaction(async (tx) => {
      // Re-point votes (unique constraint on toolId+voterFingerprint — ignore conflicts)
      await tx.execute(sql`
        UPDATE tool_votes SET tool_id = ${canonicalId}
        WHERE tool_id = ${duplicateId}
        ON CONFLICT DO NOTHING
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
    })

    revalidatePath('/admin/tools')
    revalidatePath('/admin/maintenance')
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}
