/**
 * Reindex job.
 * Rebuilds PostgreSQL full-text and trigram search indexes.
 *
 * When toolId is undefined or '__all__': runs REINDEX INDEX CONCURRENTLY on
 * both search indexes (defragments GIN indexes after bulk updates).
 *
 * When toolId is a specific UUID: touches the tool row so the expression-based
 * GIN index re-evaluates for that row on the next autovacuum pass.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb, tools } from '@the-tool-pit/db'
import type { ReindexPayload } from '@the-tool-pit/types'

export async function processReindexJob(payload: ReindexPayload): Promise<void> {
  const db = getDb()

  if (!payload.toolId || payload.toolId === '__all__') {
    console.log('[reindex] rebuilding search indexes (REINDEX INDEX CONCURRENTLY)')
    // REINDEX INDEX CONCURRENTLY does not lock out reads/writes
    await db.execute(sql`REINDEX INDEX CONCURRENTLY tools_search_idx`)
    await db.execute(sql`REINDEX INDEX CONCURRENTLY tools_name_trgm_idx`)
    console.log('[reindex] indexes rebuilt')
  } else {
    const toolId = payload.toolId
    console.log(`[reindex] touching tool ${toolId}`)
    await db
      .update(tools)
      .set({ updatedAt: new Date() })
      .where(eq(tools.id, toolId))
    console.log(`[reindex] tool ${toolId} touched`)
  }
}
