import { getDb, eventListings } from '@the-tool-pit/db'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { refreshPublishedEvent } from '/media/nas/filip/ncdata/filip/files/Robots/ttp-worktrees/event-refresh/apps/worker/src/listings/event-refresh.ts'
const db = getDb()
const today = new Date().toISOString().slice(0, 10)
const rows = await db.select().from(eventListings).where(and(eq(eventListings.status, 'published'), inArray(eventListings.eventStatus, ['tentative','confirmed']), gte(eventListings.startDate, today))).limit(2)
const plainFetch = async (url: string) => { try { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) }); const t = await r.text(); return t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ') } catch { return null } }
for (const r of rows) {
  console.log(`START ${r.name}`); const t0=Date.now(); try { const out = await refreshPublishedEvent(r, plainFetch, today); console.log(`RESULT ${r.name}: ${JSON.stringify(out)} ${Math.round((Date.now()-t0)/1000)}s`) } catch (e) { console.log(`ERR ${r.name}: ${String(e).slice(0,200)}`) }
}
process.exit(0)
