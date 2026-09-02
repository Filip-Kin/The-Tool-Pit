import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { DEFAULT_SEARCH_SORT, SEARCH_SORTS, parseSearchSort } from '@/lib/search/sort'
import { searchOrderBy } from '@/lib/search/order-by'
import { sortHref, pageHref, toSearchQuery } from '@/lib/search/url'

/**
 * `?sort=updated` sorted by relevance for as long as the parameter existed.
 *
 * The page declared `sort` in its searchParams type and then never passed it to
 * searchTools, so the backend support that had been there the whole time was
 * unreachable. Nothing failed, nothing logged, the results just came back in a
 * different order than the URL asked for, which is the kind of bug that only
 * gets found by someone reading the ORDER BY.
 *
 * So the ORDER BY gets read here instead. The clause is rendered to SQL and
 * checked against the column it is supposed to name, because "the code compiles
 * and sort is in the type" is exactly what was true while it was broken.
 */
const dialect = new PgDialect()

/** A stand-in for the ranking expression, distinctive enough to spot in the output. */
const RANK = sql<number>`(rank_score_here)`

function renderOrderBy(sortParam: string | undefined): string {
  return dialect.sqlToQuery(searchOrderBy(parseSearchSort(sortParam), RANK)).sql
}

describe('search sort', () => {
  describe('every offered sort reaches the right ORDER BY', () => {
    it('popular orders by the popularity score', () => {
      expect(renderOrderBy('popular')).toContain('"popularity_score" desc')
    })

    it('updated orders by last activity, with the unknown ones last', () => {
      const clause = renderOrderBy('updated')
      expect(clause).toContain('"last_activity_at" desc')
      // 44% of published tools have no last_activity_at. Postgres puts nulls
      // FIRST on a descending sort, so without this the recently updated page
      // opens on several hundred tools with no known activity at all.
      expect(clause).toContain('nulls last')
    })

    it('relevance orders by the ranking score', () => {
      expect(renderOrderBy('relevance')).toBe('(rank_score_here) desc')
    })

    it('offers exactly the three the ORDER BY knows about', () => {
      expect(SEARCH_SORTS.map((s) => s.value)).toEqual(['relevance', 'popular', 'updated'])
    })
  })

  describe('an unknown sort falls back to relevance rather than reaching SQL', () => {
    // 'newest' is in the shared SearchSort type and has never been implemented,
    // so it is a real value someone could pass, not a hypothetical one.
    const rejected = [undefined, '', 'newest', 'oldest', 'RELEVANCE', 'popularity_score desc', "'; drop table tools; --"]

    for (const value of rejected) {
      it(`${JSON.stringify(value)} becomes relevance`, () => {
        expect(parseSearchSort(value)).toBe(DEFAULT_SEARCH_SORT)
        expect(renderOrderBy(value)).toBe('(rank_score_here) desc')
      })
    }

    it('never puts the raw value into the clause', () => {
      for (const value of rejected) {
        if (!value) continue
        expect(renderOrderBy(value)).not.toContain(value)
      }
    })

    it('hands searchTools a sort it knows, whatever was in the URL', () => {
      expect(toSearchQuery({ sort: 'nonsense' }).sort).toBe('relevance')
      expect(toSearchQuery({ sort: 'updated' }).sort).toBe('updated')
    })
  })

  describe('the sort links keep the rest of the search', () => {
    const params = {
      q: 'swerve',
      program: 'frc',
      type: 'web_app',
      role: 'student',
      fn: 'programmer',
      official: 'true',
      rookie: 'true',
      teamcode: 'false',
      team: '254',
      year: '2026',
      page: '3',
      sort: 'popular',
    }

    it('carries every other parameter across', () => {
      const url = new URL(sortHref(params, 'updated'), 'https://frc.tools')
      expect(url.searchParams.get('sort')).toBe('updated')
      for (const key of ['q', 'program', 'type', 'role', 'fn', 'official', 'rookie', 'teamcode', 'team', 'year']) {
        expect([key, url.searchParams.get(key)]).toEqual([key, params[key as keyof typeof params]])
      }
    })

    it('goes back to the first page, because page 3 of one order is not page 3 of another', () => {
      expect(new URL(sortHref(params, 'updated'), 'https://frc.tools').searchParams.get('page')).toBeNull()
    })

    it('leaves the default sort out of the URL entirely', () => {
      expect(sortHref({ q: 'swerve', sort: 'popular' }, 'relevance')).toBe('/search?q=swerve')
      expect(sortHref({}, 'relevance')).toBe('/search')
    })

    it('keeps ?page= working as an entry point, with the filters attached', () => {
      const url = new URL(pageHref(params, 4), 'https://frc.tools')
      expect(url.searchParams.get('page')).toBe('4')
      expect(url.searchParams.get('q')).toBe('swerve')
      expect(url.searchParams.get('program')).toBe('frc')
      expect(url.searchParams.get('sort')).toBe('popular')
    })
  })

  describe('a filter that is not a number never becomes one', () => {
    // parseInt('abc') is NaN, and a NaN bound into `where team_number = $1` is
    // a Postgres error, not an empty result.
    it('drops a team or year that is not a positive integer', () => {
      const query = toSearchQuery({ team: 'abc', year: '' })
      expect(query.teamNumber).toBeUndefined()
      expect(query.seasonYear).toBeUndefined()
    })

    it('keeps a real one', () => {
      const query = toSearchQuery({ team: '254', year: '2026' })
      expect(query.teamNumber).toBe(254)
      expect(query.seasonYear).toBe(2026)
    })

    it('only accepts a program the database has', () => {
      expect(toSearchQuery({ program: 'frc' }).program).toBe('frc')
      expect(toSearchQuery({ program: 'vex' }).program).toBeUndefined()
    })
  })
})
