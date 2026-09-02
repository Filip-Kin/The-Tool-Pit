import { desc, sql, type SQL } from 'drizzle-orm'
import { tools } from '@the-tool-pit/db'
import type { SearchSortOption } from './sort'

/**
 * Kept apart from sort.ts, which is the other half of the same idea, because
 * this half names database columns and that one is imported by the results
 * list in the browser. One file for both put the Postgres driver in the client
 * bundle, and webpack said so by failing to resolve 'fs'.
 */

/**
 * The ORDER BY for a sort.
 *
 * `nulls last` on updated matters: 44% of published tools have no
 * last_activity_at at all, usually because there is no repo to read a commit
 * date from, and Postgres sorts nulls first on a descending order. Without it
 * the "recently updated" page would open on 478 tools with no known activity.
 *
 * Relevance is the fallback for the same reason it is the default. It is not a
 * no-op when there is no query either: ts_rank is 0 for every row, but the
 * seven other terms in the score are not, so a bare /search still opens on
 * WPILib and GradleRIO rather than on whatever the planner returns first.
 */
export function searchOrderBy(sort: SearchSortOption, rankScore: SQL<number>): SQL {
  switch (sort) {
    case 'popular':
      return desc(tools.popularityScore)
    case 'updated':
      return sql`${tools.lastActivityAt} desc nulls last`
    case 'relevance':
      return sql`${rankScore} desc`
  }
}
