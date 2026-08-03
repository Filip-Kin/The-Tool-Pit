'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventSearchResult } from '@the-tool-pit/types'
import { EventCard } from './event-card'
import { loadMoreEvents } from '@/app/photos/actions'

const STORAGE_KEY = 'photopit:home:v1'
/** Cap how much feed state we persist so sessionStorage stays small. */
const MAX_PERSIST = 600

interface Persisted {
  events: EventSearchResult[]
  offset: number
  hasMore: boolean
  scrollY: number
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
}: {
  initial: EventSearchResult[]
  initialOffset: number
  initialHasMore: boolean
}) {
  const [events, setEvents] = useState<EventSearchResult[]>(initial)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)

  // Raw-row offset for the next page; seen keys dedupe collapsed parents that
  // can straddle a page boundary.
  const offsetRef = useRef(initialOffset)
  const seen = useRef(new Set(initial.map((e) => e.tbaKey)))
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Latest feed state, so the scroll saver always persists current values.
  const latest = useRef<Omit<Persisted, 'scrollY'>>({ events: initial, offset: initialOffset, hasMore: initialHasMore })
  latest.current = { events, offset: offsetRef.current, hasMore }

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
      setHasMore(res.hasMore)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore])

  // Restore a prior session (loaded pages + scroll) on mount.
  useEffect(() => {
    let restored = false
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Persisted
        if (saved.events?.length) {
          seen.current = new Set(saved.events.map((e) => e.tbaKey))
          offsetRef.current = saved.offset
          setEvents(saved.events)
          setHasMore(saved.hasMore)
          restored = true
          // Wait for the restored cards to lay out, then jump back.
          requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved.scrollY)))
        }
      }
    } catch {
      // ignore malformed state
    }

    let raf = 0
    const save = () => {
      raf = 0
      try {
        const { events: evs, offset, hasMore: more } = latest.current
        const payload: Persisted = { events: evs.slice(0, MAX_PERSIST), offset, hasMore: more, scrollY: window.scrollY }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      } catch {
        // ignore quota / serialization errors
      }
    }
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(save)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    // If we restored nothing but there is saved scroll for a fresh feed, ignore.
    void restored
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
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
            <EventCard key={e.tbaKey} event={e} />
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
