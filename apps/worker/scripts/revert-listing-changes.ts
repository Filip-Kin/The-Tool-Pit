/**
 * Undo automatic listing changes recorded in listing_changes.
 *
 *   cd apps/worker
 *   DATABASE_URL=... bun scripts/revert-listing-changes.ts \
 *     [--actor field-refresh] [--since 2026-10-01] [--entity-id <uuid>] [--dry-run=false]
 *
 * Dry run by default: prints what it would restore and writes nothing. Pass
 * --dry-run=false (or --apply) to write.
 *
 * Per (listing, column) only the LATEST matching change is undone, and only
 * when the column still holds that change's new value. A column somebody has
 * changed since is reported and left alone (planRevert in
 * src/listings/change-log.ts). Each restore is itself logged to
 * listing_changes with actor 'revert', in the same transaction as the write.
 */
import { and, eq, gte, inArray, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { getDb, listingChanges, practiceFields, eventListings, tools } from '@the-tool-pit/db'
import { applyLoggedPatch, fromJson, planRevert, type ChangeEntityType } from '../src/listings/change-log.js'

function arg(name: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i < 0) return undefined
  const a = process.argv[i]!
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1)
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : 'true'
}

const actor = arg('actor')
const since = arg('since')
const entityId = arg('entity-id')
const dryArg = arg('dry-run')
const dryRun = process.argv.includes('--apply') ? false : dryArg === undefined ? true : !/^(false|0|no)$/i.test(dryArg)

const TABLES: Record<ChangeEntityType, PgTable & { id: PgColumn }> = {
  field: practiceFields,
  event: eventListings,
  tool: tools,
}

async function main(): Promise<void> {
  if (since && Number.isNaN(new Date(since).getTime())) throw new Error(`--since "${since}" is not a date`)
  const db = getDb()
  const where: SQL[] = []
  if (actor) where.push(eq(listingChanges.actor, actor))
  if (since) where.push(gte(listingChanges.createdAt, new Date(since)))
  if (entityId) where.push(eq(listingChanges.entityId, entityId))
  const changes = await db
    .select()
    .from(listingChanges)
    .where(where.length ? and(...where) : undefined)

  console.log(
    `[revert] ${changes.length} change rows match (actor=${actor ?? 'any'}, since=${since ?? 'any'}, entity=${entityId ?? 'any'})${dryRun ? ', DRY RUN' : ''}`,
  )

  const current = new Map<string, Record<string, unknown>>()
  for (const type of Object.keys(TABLES) as ChangeEntityType[]) {
    const ids = [...new Set(changes.filter((c) => c.entityType === type).map((c) => c.entityId))]
    if (ids.length === 0) continue
    const table = TABLES[type]
    const rows = (await db.select().from(table as PgTable).where(inArray(table.id, ids))) as Array<Record<string, unknown>>
    for (const r of rows) current.set(`${type}:${String(r.id)}`, r)
  }

  const steps = planRevert(changes, current)
  const show = (v: unknown) => {
    const s = JSON.stringify(v ?? null)
    return s.length > 160 ? `${s.slice(0, 159)}…` : s
  }
  let restored = 0
  for (const step of steps) {
    const c = step.change
    const label = `${c.entityType} ${c.entityId} ${c.column}`
    if (step.action !== 'restore') {
      console.log(`[revert] skip ${label}: ${step.action === 'entity_gone' ? 'listing gone' : `changed since, now ${show(step.current)}`}`)
      continue
    }
    console.log(`[revert] ${dryRun ? 'would restore' : 'restore'} ${label}: ${show(c.newValue)} -> ${show(c.oldValue)}`)
    if (dryRun) continue
    const type = c.entityType as ChangeEntityType
    const table = TABLES[type]
    if (!table) {
      console.log(`[revert] skip ${label}: unknown entity type`)
      continue
    }
    const written = await applyLoggedPatch({
      entityType: type,
      table,
      id: c.entityId,
      actor: 'revert',
      patch: { [c.column]: fromJson(table, c.column, c.oldValue) },
      proof: { [c.column]: { quote: `revert of listing_changes ${c.id}`, source: null } },
      // Checked again under the lock: still the value the change wrote.
      stillCurrent: (_k, value) => planRevert([c], new Map([[`${c.entityType}:${c.entityId}`, { [c.column]: value }]]))[0]?.action === 'restore',
    })
    if (written.length > 0) restored++
    else console.log(`[revert] skip ${label}: changed while reverting`)
  }
  console.log(`[revert] done: ${dryRun ? 'nothing written' : `${restored} restored`}, ${steps.length} candidates`)
}

main()
  .then(() => setTimeout(() => process.exit(0), 250))
  .catch((err) => {
    console.error(err)
    setTimeout(() => process.exit(1), 250)
  })
