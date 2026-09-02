import { sql, type SQL } from 'drizzle-orm'
import { tools, toolVotes } from './schema/index'

/**
 * What a listing's popularity_score is, in one place.
 *
 * The column is denormalised, so several code paths write it, and for a long
 * time each one carried its own idea of the formula. Two of them left the votes
 * out. The result was not a rounding difference: every upvote a visitor cast
 * was erased by the next crawl that happened to re-publish that listing, and
 * nothing looked broken because the daily pass put it back the following
 * morning.
 *
 * THREE WRITERS, AND THEY ARE ALL LEGITIMATE. Somebody clicks and the count has
 * to move now. The daily pass re-reads stars and likes and has to rewrite the
 * lot. The publish path writes a brand new row that has no score yet. What is
 * not legitimate is three spellings of the same sum.
 *
 * Reads the row's own columns, so it is correct wherever it is used and does
 * not need the caller to have fetched anything. Postgres evaluates an UPDATE's
 * SET list against the row as it was BEFORE the statement, so a path that has
 * just changed github_stars must run this as a second statement, not fold it
 * into the same SET.
 */
export const popularityScoreSql: SQL = sql`${tools.githubStars} + ${tools.chiefDelphiLikes} + coalesce((
  select count(*) from ${toolVotes} tv where tv.tool_id = ${tools.id}
), 0)`
