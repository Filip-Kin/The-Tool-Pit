'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * The signed-in user as the client sees it. Deliberately thin: anything that
 * matters (admin, team membership, favourites) is read server-side from the
 * session cookie, never from this object.
 */
export interface SessionUser {
  id: string
  email: string | null
  displayName: string | null
  photoUrl: string | null
}

interface SessionContextValue {
  user: SessionUser | null
  loading: boolean
  /** Re-read /api/auth/session, e.g. straight after a sign-in. */
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
})

export function SessionProvider({
  initialUser = null,
  children,
}: {
  initialUser?: SessionUser | null
  children: ReactNode
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser)
  // When the server already resolved the user there is nothing to wait for,
  // so the first paint is not a spinner.
  const [loading, setLoading] = useState(initialUser === null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const body = await res.json()
      setUser(body.user ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialUser === null) void refresh()
  }, [initialUser, refresh])

  return (
    <SessionContext.Provider value={{ user, loading, refresh }}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext)
}
