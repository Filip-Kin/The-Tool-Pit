/**
 * One-off: run the auto-publish decision over every 'flagged' grant candidate
 * that already has an extraction, so the queue filed before auto-publish
 * existed gets the same treatment as a fresh extraction.
 *
 * Same path as the worker (../src/grants/auto-publish.ts): the intake dedupe,
 * then a publish REQUEST to the site's queue-decisions route, which runs the
 * review deck's gate unchanged. No override is ever sent. A refusal is appended
 * to the row's review note, once.
 *
 *   cd apps/worker
 *   DATABASE_URL=... INTERNAL_API_SECRET=... WEB_INTERNAL_URL=... \
 *     bun scripts/autopublish-backlog.ts [--dry-run]
 *
 * --dry-run prints each decision and asks nothing.
 */
import { getDb, grantCandidates, eq, and, isNotNull, asc } from '@the-tool-pit/db'
import { autoPublishCandidate, shouldAutoPublish, type AutoPublishOutcome } from '../src/grants/auto-publish.js'

const dryRun = process.argv.includes('--dry-run')

async function main(): Promise<void> {
  const rows = await getDb()
    .select()
    .from(grantCandidates)
    .where(and(eq(grantCandidates.status, 'flagged'), isNotNull(grantCandidates.extraction)))
    .orderBy(asc(grantCandidates.createdAt))

  console.log(`[grant-autopublish] backlog: ${rows.length} flagged candidates with an extraction${dryRun ? ' (dry run)' : ''}`)

  const tally = new Map<string, number>()
  for (const row of rows) {
    let kind: string
    if (dryRun) {
      const decision = shouldAutoPublish(row)
      kind = decision.ok ? 'would_ask' : 'skipped'
      console.log(`[grant-autopublish] ${row.id} ${decision.ok ? 'would ask the site to publish' : `skipped: ${decision.reason}`}`)
    } else {
      // One at a time: each publish is a full gate run on the site.
      const outcome: AutoPublishOutcome = await autoPublishCandidate(row)
      kind = outcome.kind
    }
    tally.set(kind, (tally.get(kind) ?? 0) + 1)
  }

  console.log(
    `[grant-autopublish] backlog done: ${[...tally.entries()].map(([k, n]) => `${k}=${n}`).join(', ') || 'nothing to do'}`,
  )
}

main()
  .then(() => {
    // The pg pool keeps the event loop alive; give stdout a moment, then go.
    setTimeout(() => process.exit(0), 250)
  })
  .catch((err) => {
    console.error(err)
    setTimeout(() => process.exit(1), 250)
  })
