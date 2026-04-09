'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * When `active` is true, refreshes the page every `intervalMs` milliseconds
 * so the server-rendered queue stats stay up to date without a full page reload.
 */
export function QueuePoller({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => router.refresh(), intervalMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [active, intervalMs, router])

  return null
}
