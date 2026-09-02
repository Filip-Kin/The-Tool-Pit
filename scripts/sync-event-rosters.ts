/**
 * Kept as a one-shot for a moderator who wants a count NOW.
 *
 * The work moved into apps/worker/src/listings/roster-refresh.ts and runs
 * daily at 05:50, because a count that is only as fresh as the last time
 * somebody remembered to run a script is the one this listing most needs to be
 * current: it moves week to week, and a stale one has a team planning around a
 * place at an event that filled up a month ago.
 *
 * This wrapper exists so the documented command still works, and so nothing
 * ends up with two copies of the fetching and hashing.
 *
 *   DATABASE_URL=... TBA_API_KEY=... bun scripts/sync-event-rosters.ts
 */
import { processRosterRefreshJob } from '../apps/worker/src/listings/roster-refresh'

processRosterRefreshJob()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
