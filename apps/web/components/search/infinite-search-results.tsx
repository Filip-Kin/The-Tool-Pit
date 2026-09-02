'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ToolCard } from '@/components/tools/tool-card'
import { SortControl } from '@/components/search/sort-control'
import { buttonClass } from '@/components/ui/button'
import type { SearchResultRow } from '@/lib/search/search'
import type { SearchSortOption } from '@/lib/search/sort'
import { pageHref, searchSignature, type SearchUrlParams } from '@/lib/search/url'
import { loadMoreSearchResults } from '@/app/(public)/search/actions'

const STORAGE_KEY = 'toolpit:search:v1'
/** Cap how many rows we persist so sessionStorage stays small. Fifteen pages is well past where anyone stops scrolling. */
const MAX_PERSIST = 300

/**
 * Whether this list has already been mounted in this document.
 *
 * Module scope on purpose, because that is exactly the lifetime we need. It
 * survives a client-side navigation away and back, which never reloads the
 * document, and it does not survive a reload or a fresh load, which is when we
 * want the server's results rather than a cache of them.
 *
 * The navigation type alone cannot tell those apart. Opening a tool from a
 * result and pressing Back is the ordinary way to leave and return, and it is a
 * soft navigation, so `performance` still reports the ORIGINAL load as a plain
 * 'navigate' and a check for 'back_forward' sees nothing. Measured: 60 loaded
 * results came back as 20, at the top of the page, which is the whole thing
 * this cache exists to prevent.
 */
let mountedBefore = false

/** A result as it survives JSON: the activity date comes back a string. */
type StoredRow = Omit<SearchResultRow, 'lastActivityAt'> & { lastActivityAt: string | null }

interface Persisted {
  /** The search these results belong to. A mismatch means this cache is somebody else's search. */
  signature: string
  tools: StoredRow[]
  nextPage: number
  hasMore: boolean
  total: number
  /**
   * Saved with the results, because they are only useful together. Restore 300
   * rows without them and every card past the first page comes back with its
   * upvote unpressed and its bookmark empty, over a vote that was counted.
   */
  voted: string[]
  favorited: string[]
  scrollY: number
}

interface Props {
  initial: SearchResultRow[]
  total: number
  query: string
  /** The URL as it stands, so an appended page is the same search as the first one. */
  params: SearchUrlParams
  sort: SearchSortOption
  /** The page the server rendered. Usually 1, but `?page=` is still a way in. */
  initialPage: number
  pageSize: number
  initialVoted: string[]
  initialFavorited: string[]
}

/**
 * Search results that grow as you scroll.
 *
 * Replaces a row of numbered page links that got to 55 buttons on a broad
 * search. Same shape as the photos feed in components/albums, including the
 * part that matters most: the loaded pages and the scroll position go to
 * sessionStorage, so opening a tool and coming back puts the reader where they
 * were rather than at the top of page one.
 *
 * The sentinel is not the only way down. A real Load more link sits under the
 * grid, because an IntersectionObserver is unreachable by keyboard, invisible
 * without JavaScript and has nothing to offer when a fetch fails. It is a link
 * to `?page=N` rather than a button, so it is also the href a crawler follows
 * past the first twenty results.
 */
export function InfiniteSearchResults({
  initial,
  total: initialTotal,
  query,
  params,
  sort,
  initialPage,
  pageSize,
  initialVoted,
  initialFavorited,
}: Props) {
  const signature = searchSignature(params)

  const [tools, setTools] = useState<SearchResultRow[]>(initial)
  const [total, setTotal] = useState(initialTotal)
  const [voted, setVoted] = useState<Set<string>>(() => new Set(initialVoted))
  const [favorited, setFavorited] = useState<Set<string>>(() => new Set(initialFavorited))
  const [hasMore, setHasMore] = useState(initialPage * pageSize < initialTotal)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const nextPageRef = useRef(initialPage + 1)
  const [nextPage, setNextPage] = useState(initialPage + 1)
  const seen = useRef(new Set(initial.map((t) => t.id)))
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Latest list state, so the scroll saver always persists current values.
  const latest = useRef<Omit<Persisted, 'scrollY' | 'signature' | 'tools'> & { tools: SearchResultRow[] }>({
    tools: initial,
    nextPage: initialPage + 1,
    hasMore: initialPage * pageSize < initialTotal,
    total: initialTotal,
    voted: initialVoted,
    favorited: initialFavorited,
  })
  latest.current = {
    tools,
    nextPage,
    hasMore,
    total,
    voted: [...voted],
    favorited: [...favorited],
  }

  const load = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    setFailed(false)
    try {
      const page = nextPageRef.current
      const batch = await loadMoreSearchResults(params, page)
      nextPageRef.current = page + 1
      setNextPage(page + 1)
      setTools((prev) => {
        // Ranking ties can put the same tool on two adjacent pages. Dropping the
        // repeat is cheaper than a React key collision in the grid.
        const add = batch.tools.filter((t) => !seen.current.has(t.id))
        add.forEach((t) => seen.current.add(t.id))
        return [...prev, ...add]
      })
      setVoted((prev) => new Set([...prev, ...batch.voted]))
      setFavorited((prev) => new Set([...prev, ...batch.favorited]))
      // The count comes back with every batch rather than being trusted from
      // the first render, so a listing published while someone is scrolling
      // does not leave the total saying something that stopped being true.
      setTotal(batch.total)
      setHasMore(batch.hasMore)
    } catch {
      // The sentinel stops here. Auto-retrying a failing action once per scroll
      // event is how a dead network becomes a hundred requests. The Load more
      // link is the way back, and it is already on screen.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore, params])

  // Last real scroll position. We save THIS, never live window.scrollY at
  // teardown: the router zeroes the scroll just before unmount, which would
  // clobber the saved position with 0.
  const lastY = useRef(0)
  const restoring = useRef(true)
  const rafId = useRef(0)

  const save = useCallback(() => {
    rafId.current = 0
    try {
      const current = latest.current
      // Truncated at a page boundary, so what comes back is a whole number of
      // pages and the next request picks up exactly where the saved rows stop.
      const kept = current.tools.slice(0, MAX_PERSIST)
      const keptPages = Math.ceil(kept.length / pageSize)
      const payload: Persisted = {
        signature,
        tools: kept.map((t) => ({
          ...t,
          lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
        })),
        nextPage: initialPage + keptPages,
        hasMore: kept.length < current.tools.length ? true : current.hasMore,
        total: current.total,
        voted: current.voted,
        favorited: current.favorited,
        scrollY: lastY.current,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // ignore quota / serialization errors
    }
  }, [signature, initialPage, pageSize])

  // Persist as soon as a page lands, not only on the next scroll event. The
  // batch that arrives after the reader has stopped moving is exactly the one
  // they were reading when they clicked through, and a scroll-only saver is
  // always one page behind it.
  useEffect(() => {
    if (tools !== initial) save()
  }, [tools, initial, save])

  // Restore a prior session (loaded pages + scroll) on mount, and persist it as
  // the visitor scrolls, so opening a tool and coming back lands where they were.
  useEffect(() => {
    lastY.current = window.scrollY

    // Restore only when the reader is coming BACK to this list, by either of
    // the two ways that happens: the module flag for a client-side return, and
    // the navigation type for a hard one. A fresh load or a reload keeps the
    // server's results, so a tool published a minute ago shows up straight away.
    const navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
    const returning = mountedBefore || navType === 'back_forward'
    mountedBefore = true

    try {
      const raw = returning ? sessionStorage.getItem(STORAGE_KEY) : null
      if (!returning) sessionStorage.removeItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Persisted
        if (saved.signature === signature && saved.tools?.length && saved.scrollY > 0) {
          const revived: SearchResultRow[] = saved.tools.map((t) => ({
            ...t,
            // JSON has no date type, and the card formats this one.
            lastActivityAt: t.lastActivityAt ? new Date(t.lastActivityAt) : null,
          }))
          seen.current = new Set(revived.map((t) => t.id))
          nextPageRef.current = saved.nextPage
          setNextPage(saved.nextPage)
          setTools(revived)
          setVoted(new Set(saved.voted ?? []))
          setFavorited(new Set(saved.favorited ?? []))
          setTotal(saved.total)
          setHasMore(saved.hasMore)
          lastY.current = saved.scrollY
          const target = saved.scrollY
          // Re-assert the target every frame until it holds for a few frames
          // (beating the router's own scroll-to-top), or we run out of time.
          const startedAt = performance.now()
          let stable = 0
          const reassert = () => {
            if (Math.abs(window.scrollY - target) <= 2) {
              stable++
            } else {
              stable = 0
              window.scrollTo(0, target)
            }
            if (stable < 3 && performance.now() - startedAt < 1500) {
              requestAnimationFrame(reassert)
            } else {
              restoring.current = false
            }
          }
          requestAnimationFrame(() => requestAnimationFrame(reassert))
        } else {
          restoring.current = false
        }
      } else {
        restoring.current = false
      }
    } catch {
      restoring.current = false
    }

    const onScroll = () => {
      // Ignore the scrolling we do while restoring, so only a genuine user
      // scroll moves the saved position.
      if (restoring.current) return
      lastY.current = window.scrollY
      if (rafId.current) return
      rafId.current = requestAnimationFrame(save)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
      if (rafId.current) cancelAnimationFrame(rafId.current)
      save()
    }
  }, [save, signature])

  // Load the next page when the sentinel comes into view. Not while a load has
  // failed: the reader gets it back with the link below.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || failed) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void load()
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [load, failed])

  const shown = tools.length
  const complete = shown >= total

  return (
    <div className="flex flex-col gap-6">
      {/* Count on the left, sort on the right: the two facts about the list, on
          the row above it. Stacked on a phone, where three sort words and a
          count do not share a line. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          {total === 0 ? (
            query ? (
              <span>No results for &ldquo;{query}&rdquo;</span>
            ) : (
              <span>No tools found</span>
            )
          ) : (
            <span>
              {/* Honest as the list grows: it says how many are on screen while
                  there are more to come, and drops back to the plain total once
                  every match is loaded. */}
              {complete
                ? `${total.toLocaleString()} ${total === 1 ? 'tool' : 'tools'}`
                : `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} tools`}
              {query && (
                <>
                  {' '}for <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
                </>
              )}
            </span>
          )}
        </div>

        {/* Nothing to order when nothing matched. */}
        {total > 0 && <SortControl params={params} sort={sort} hasQuery={Boolean(query.trim())} />}
      </div>

      {shown === 0 && query && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="mb-1 text-sm font-medium text-foreground">No tools found</p>
          <p className="text-xs text-muted">
            Try a different search term, or{' '}
            <Link href="/submit" className="text-primary hover:underline">
              submit it
            </Link>
            .
          </p>
        </div>
      )}

      {shown > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              voted={voted.has(tool.id)}
              favorited={favorited.has(tool.id)}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-px w-full" aria-hidden />

      {hasMore && (
        <div className="flex flex-col items-center gap-2 pt-2">
          {failed && (
            <p className="text-sm text-muted" role="alert">
              Could not load more results.
            </p>
          )}
          {/* A link, not a button. It goes to the next page for a crawler and
              for a reader with no JavaScript; with JavaScript it appends in
              place instead of navigating. */}
          <Link
            href={pageHref(params, nextPage)}
            rel="next"
            onClick={(event) => {
              event.preventDefault()
              void load()
            }}
            aria-busy={loading}
            className={buttonClass({ variant: 'secondary', size: 'sm' })}
          >
            {loading ? 'Loading…' : failed ? 'Try again' : 'Load more'}
          </Link>
        </div>
      )}

      {!hasMore && total > pageSize && (
        <p className="pt-2 text-center text-xs text-muted-2">That&apos;s all of them.</p>
      )}
    </div>
  )
}
