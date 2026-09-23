/**
 * One-off: run the proven-change rule over the grant_changes rows already
 * pending, and apply the proven ones through the site.
 *
 * The monitor applies proven rows as it files them (grants/monitor.ts). Rows
 * filed before that existed are still waiting for a click. This reads each
 * pending row with the snapshot it was filed from, runs proveChange from
 * grants/change-proof.ts over that snapshot's stored text, and:
 *
 *   - prints every verdict, with the quote or the reason;
 *   - with --apply: marks proven rows autoApplicable with the quote leading
 *     reasoning, clears a stale autoApplicable on unproven ones, then POSTs
 *     the proven ids to /api/internal/queue-decisions as actor 'auto', the
 *     same call the monitor makes. A refusal leaves the row pending.
 *
 * Without --apply it writes nothing.
 *
 * The snapshot keeps the grant's info URL, not the URL the text actually came
 * from, so an archive.org fallback read cannot be told apart here; the monitor
 * can, and refuses those.
 *
 * Run from apps/worker:
 *   bun --env-file=../../.env src/scripts/apply-proven-grant-changes.ts           # dry run
 *   bun --env-file=../../.env src/scripts/apply-proven-grant-changes.ts --apply
 * Needs DATABASE_URL, and INTERNAL_API_SECRET (plus WEB_INTERNAL_URL or
 * NEXT_PUBLIC_URL for a non-production site) for --apply.
 */
import { asc, eq } from 'drizzle-orm'
import { getDb, grantChanges, grants, grantSnapshots } from '@the-tool-pit/db'
import { proveChange, reasoningWithProof } from '../grants/change-proof.js'
import { askSiteToDecideGrantChanges, queueDecisionsUrl } from '../site/queue-decisions.js'

const apply = process.argv.includes('--apply')

async function main(): Promise<void> {
  const db = getDb()
  const rows = await db
    .select({
      id: grantChanges.id,
      field: grantChanges.field,
      oldValue: grantChanges.oldValue,
      newValue: grantChanges.newValue,
      reasoning: grantChanges.reasoning,
      autoApplicable: grantChanges.autoApplicable,
      slug: grants.slug,
      snapshotText: grantSnapshots.contentText,
      snapshotUrl: grantSnapshots.url,
      extracted: grantSnapshots.extracted,
    })
    .from(grantChanges)
    .innerJoin(grants, eq(grants.id, grantChanges.grantId))
    .leftJoin(grantSnapshots, eq(grantSnapshots.id, grantChanges.snapshotId))
    .where(eq(grantChanges.status, 'pending'))
    .orderBy(asc(grantChanges.createdAt))

  console.log(`${rows.length} pending change(s)${apply ? '' : ' (dry run, nothing is written)'}\n`)

  const proven: Array<{ id: string; field: string; slug: string }> = []
  for (const r of rows) {
    const verdict = r.snapshotText
      ? proveChange(r, { pageText: r.snapshotText, pageUrl: r.snapshotUrl, extracted: r.extracted })
      : ({ proven: false, reason: 'no snapshot text for this row' } as const)
    const label = `${r.slug} ${r.field}: ${JSON.stringify(r.oldValue)} -> ${JSON.stringify(r.newValue)}`
    if (verdict.proven) {
      console.log(`PROVEN   ${label}\n         "${verdict.quote}"`)
      proven.push({ id: r.id, field: r.field, slug: r.slug })
      if (apply && !(r.reasoning ?? '').startsWith('Proof on the funder')) {
        await db
          .update(grantChanges)
          .set({ autoApplicable: true, reasoning: reasoningWithProof(r.reasoning, verdict.quote).slice(0, 1000) })
          .where(eq(grantChanges.id, r.id))
      } else if (apply && !r.autoApplicable) {
        await db.update(grantChanges).set({ autoApplicable: true }).where(eq(grantChanges.id, r.id))
      }
    } else {
      console.log(`manual   ${label}\n         ${verdict.reason}`)
      if (apply && r.autoApplicable) {
        await db.update(grantChanges).set({ autoApplicable: false }).where(eq(grantChanges.id, r.id))
      }
    }
  }

  console.log(`\n${proven.length} of ${rows.length} proven`)
  if (!apply || proven.length === 0) return

  // Dates before status, so a cycle the first date creates exists when its status is set.
  const order = (field: string) => (/\.status$/.test(field) ? 1 : 0)
  proven.sort((a, b) => order(a.field) - order(b.field))
  console.log(`asking ${queueDecisionsUrl()} to apply them as 'auto'`)
  const results = await askSiteToDecideGrantChanges(proven.map((p) => p.id), 'apply', 'auto')
  for (const [i, r] of results.entries()) {
    const p = proven[i]
    console.log(`${r.ok ? 'applied ' : 'refused '} ${p.slug} ${p.field}${r.ok ? '' : `: ${r.error ?? 'unknown error'} (left pending)`}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
