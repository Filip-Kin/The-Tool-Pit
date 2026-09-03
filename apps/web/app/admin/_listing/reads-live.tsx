'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Re-fetch a server-rendered reads page every few seconds while a sweep runs.
 *
 * Mounted only when the read-candidates queue has work in flight (active or
 * waiting > 0), so a quiet queue costs nothing. router.refresh() re-runs the
 * server component with its force-dynamic queries, which is enough to move the
 * progress bar and float a just-read row to the top without a client store.
 */
export function ReadsLive({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])
  return null
}
