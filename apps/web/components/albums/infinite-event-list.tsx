'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventSearchResult } from '@the-tool-pit/types'
import type { AlbumClaimStates } from '@/lib/albums/claim-states'
import { EventCard } from './event-card'
import { loadMoreEvents } from '@/app/photos/actions'

const STORAGE_KEY = 'photopit:home:v1'

/**
 * Whether this component has already been mounted in this document.
 *
 * Module scope on purpose, because that is exactly the lifetime the restore
 * needs: it survives a client-side navigation away and back, and it does not
 * survive a reload or a fresh load. See the long note at the restore itself
 * for why the navigation type alone could not do this job.
 */
let mountedBefore = false

/** Cap how much feed state we persist so sessionStorage stays small. */
const MAX_PERSIST = 600

interface Persisted {
  events: EventSearchResult[]
  offset: number
  hasMore: boolean
  scrollY: number
  /**
   * Saved with the events, because they are only useful together. Restore the
   * events without these and every card past the first page comes back with a
   * menu that has quietly dropped its claim item, which is the one thing on
   * this feed a photographer came for.
   */
  claimStates: AlbumClaimStates
}

/**
 * Chronological event feed with infinite scroll. Persists the loaded pages and
 * scroll position to sessionStorage, so a browser Back (e.g. after opening an
 * album) drops the visitor exactly where they left off - same events loaded,
 * same scroll offset - instead of resetting to the first page.
 */
export function InfiniteEventList({
  initial,
  initialOffset,
  initialHasMore,
  initialClaimStates,
}: {
  initial: EventSearchResult[]
  initialOffset: number
  initialHasMore: boolean
  /** Claim state per sole-album id, extended by every page the feed appends. */
  initialClaimStates: AlbumClaimStates
}) {
  const [events, setEvents] = useState<EventSearchResult[]>(initial)
  const [claimStates, setClaimStates] = useState<AlbumClaimStates>(initialClaimStates)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)

  // Raw-row offset for the next page; seen keys dedupe collapsed parents that
  // can straddle a page boundary.
  const offsetRef = useRef(initialOffset)
  const seen = useRef(new Set(initial.map((e) => e.tbaKey)))
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Latest feed state, so the scroll saver always persists current values.
  const latest = useRef<Omit<Persisted, 'scrollY'>>({
    events: initial,
    offset: initialOffset,
    hasMore: initialHasMore,
    claimStates: initialClaimStates,
  })
  latest.current = { events, offset: offsetRef.current, hasMore, claimStates }

  const load = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const res = await loadMoreEvents(offsetRef.current)
      offsetRef.current += res.rawCount
      setEvents((prev) => {
        const add = res.events.filter((e) => !seen.current.has(e.tbaKey))
        add.forEach((e) => seen.current.add(e.tbaKey))
        return [...prev, ...add]
      })
      setClaimStates((prev) => ({ ...prev, ...res.claimStates }))
      setHasMore(res.hasMore)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore])

  // Restore a prior session (loaded pages + scroll) on mount, and persist it as
  // the visitor scrolls so a browser Back drops them exactly where they were.
  useEffect(() => {
    // Last real scroll position. We save THIS, never live window.scrollY at
    // teardown - the router zeroes the scroll just before unmount, which would
    // otherwise clobber the saved position with 0.
    const lastY = { current: window.scrollY }
    let restoring = true

    // Restore the saved feed and scroll only when the reader is COMING BACK. On
    // a fresh load or a reload we keep the server-fresh `initial`, which
    // reflects just-approved albums and cover changes, so admin edits show up
    // immediately.
    //
    // The navigation type alone cannot tell those apart, and relying on it made
    // this restore dead code. Opening an album from the feed is a client-side
    // navigation, so the document never reloads and `performance` still reports
    // the ORIGINAL load as a plain 'navigate'. The back_forward check therefore
    // never fired for the ordinary case: a reader who had scrolled to 60 events
    // came back to 20, at the top, which is the exact thing this cache exists to
    // prevent. Measured in the search feed, which was copied from this file.
    //
    // The module flag has the lifetime we actually want. It survives a soft
    // navigation away and back, and it does not survive a reload or a fresh
    // load. back_forward is kept as well, for a real browser Back after a hard
    // load.
    const navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
    const returning = mountedBefore || navType === 'back_forward'
    mountedBefore = true

    try {
      const raw = returning ? sessionStorage.getItem(STORAGE_KEY) : null
      if (!returning) sessionStorage.removeItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Persisted
        if (saved.events?.length && saved.scrollY > 0) {
          seen.current = new Set(saved.events.map((e) => e.tbaKey))
          offsetRef.current = saved.offset
          setEvents(saved.events)
          setClaimStates(saved.claimStates ?? {})
          setHasMore(saved.hasMore)
          lastY.current = saved.scrollY
          const target = saved.scrollY
          // Re-assert the target every frame until it holds for a few frames
          // (beating the router's own post-navigation scroll-to-top), or we run
          // out of time. Cards reserve fixed-aspect space so height settles fast.
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
              restoring = false
            }
          }
          requestAnimationFrame(() => requestAnimationFrame(reassert))
        } else {
          restoring = false
        }
      } else {
        restoring = false
      }
    } catch {
      restoring = false
    }

    let raf = 0
    const save = () => {
      raf = 0
      try {
        const { events: evs, offset, hasMore: more, claimStates: states } = latest.current
        const payload: Persisted = {
          events: evs.slice(0, MAX_PERSIST),
          offset,
          hasMore: more,
          scrollY: lastY.current,
          claimStates: states,
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      } catch {
        // ignore quota / serialization errors
      }
    }
    const onScroll = () => {
      // Ignore scroll events we generate while restoring, so a genuine user
      // scroll (which cancels the restore) is the only thing that moves lastY.
      if (restoring) return
      lastY.current = window.scrollY
      if (raf) return
      raf = requestAnimationFrame(save)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
      if (raf) cancelAnimationFrame(raf)
      save()
    }
  }, [])

  // Load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void load()
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [load])

  return (
    <>
      {events.length === 0 ? (
        <p className="text-sm text-muted">No albums yet. Submit one to get it started.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <EventCard
              key={e.tbaKey}
              event={e}
              soleAlbumClaimState={e.soleAlbumId ? claimStates[e.soleAlbumId] : undefined}
            />
          ))}
        </div>
      )}
      <div ref={sentinelRef} className="h-px w-full" />
      {loading && <p className="mt-6 text-center text-sm text-muted">Loading more…</p>}
      {!hasMore && events.length > 0 && (
        <p className="mt-6 text-center text-xs text-muted-2">That&apos;s all of them.</p>
      )}
    </>
  )
}
