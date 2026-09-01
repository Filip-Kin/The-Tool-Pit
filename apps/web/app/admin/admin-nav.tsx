'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Admin navigation: the verticals down the side, each with the same slots.
 *
 * Every vertical gets Submissions, Candidates, Crawl jobs, the full list, and
 * Sources, in that order, because that is the order a queue is worked: what
 * people sent us, what a crawler found, whether the crawler ran, everything we
 * hold, and the knobs. A vertical that genuinely has no page for a slot omits
 * it rather than linking somewhere that 404s.
 *
 * Crawl jobs is one page with a vertical filter, not five pages. The five job
 * tables have identical columns and the overnight sweeps all land within two
 * hours of each other, so the answer to "did anything run last night" is one
 * screen.
 */

interface NavItem {
  href: string
  label: string
}

interface NavGroup {
  /** Null for the ungrouped links at the top, which never collapse. */
  label: string | null
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/admin', label: 'Overview' }],
  },
  {
    label: 'Tools',
    items: [
      { href: '/admin/submissions', label: 'Submissions' },
      { href: '/admin/candidates', label: 'Candidates' },
      { href: '/admin/crawls?vertical=tools', label: 'Crawl jobs' },
      { href: '/admin/tools', label: 'All tools' },
      { href: '/admin/sources', label: 'Sources' },
      { href: '/admin/votes', label: 'Votes' },
    ],
  },
  {
    label: 'Photos',
    items: [
      { href: '/admin/album-submissions', label: 'Submissions' },
      { href: '/admin/album-candidates', label: 'Candidates' },
      { href: '/admin/crawls?vertical=photos', label: 'Crawl jobs' },
      { href: '/admin/album-sources', label: 'Sources' },
    ],
  },
  {
    label: 'Off-season events',
    items: [
      { href: '/admin/event-listings', label: 'Submissions' },
      { href: '/admin/event-listings/candidates', label: 'Candidates' },
      { href: '/admin/crawls?vertical=events', label: 'Crawl jobs' },
      { href: '/admin/event-listings?status=all', label: 'All events' },
      { href: '/admin/event-listings/sources', label: 'Sources' },
    ],
  },
  {
    label: 'Practice fields',
    items: [
      { href: '/admin/practice-fields', label: 'Submissions' },
      { href: '/admin/practice-fields/candidates', label: 'Candidates' },
      { href: '/admin/crawls?vertical=fields', label: 'Crawl jobs' },
      { href: '/admin/practice-fields?status=all', label: 'All fields' },
      { href: '/admin/practice-fields/sources', label: 'Sources' },
      { href: '/admin/field-edits', label: 'Suggested edits' },
    ],
  },
  {
    label: 'Grants',
    items: [
      { href: '/admin/grants/candidates', label: 'Candidates' },
      { href: '/admin/crawls?vertical=grants', label: 'Crawl jobs' },
      { href: '/admin/grants', label: 'All grants' },
      { href: '/admin/grants/sources', label: 'Sources' },
      { href: '/admin/grants/changes', label: 'Changes' },
    ],
  },
  {
    label: 'Accounts',
    items: [{ href: '/admin/claims', label: 'Listing claims' }],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/crawls', label: 'Crawl jobs, all' },
      { href: '/admin/analytics', label: 'Analytics' },
      { href: '/admin/maintenance', label: 'Maintenance' },
    ],
  },
]

const STORAGE_KEY = 'admin-nav-groups'

/**
 * Which link is the current page.
 *
 * Several items share a pathname and differ only by query, e.g. the events
 * Submissions and All events links. The item with the most query parameters
 * that all match wins, so `?status=all` highlights All events and a bare path
 * highlights Submissions.
 */
function activeHref(pathname: string, search: URLSearchParams): string | null {
  let best: string | null = null
  let bestScore = -1

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const [path, query] = item.href.split('?')
      if (path !== pathname) continue
      let score = 0
      let matches = true
      for (const [key, value] of new URLSearchParams(query ?? '')) {
        if (search.get(key) === value) score++
        else matches = false
      }
      if (!matches) continue
      if (score > bestScore) {
        bestScore = score
        best = item.href
      }
    }
  }
  return best
}

export function AdminNav() {
  const pathname = usePathname()
  const search = useSearchParams()
  const active = activeHref(pathname, search)

  // Null until the browser has been read, so the first render matches the
  // server's and hydration does not complain.
  const [openState, setOpenState] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setOpenState(JSON.parse(raw) as Record<string, boolean>)
    } catch {
      // A corrupt or blocked localStorage is not worth a broken sidebar.
    }
  }, [])

  function toggle(label: string, next: boolean) {
    const updated = { ...(openState ?? {}), [label]: next }
    setOpenState(updated)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    } catch {
      // Same as above: the toggle still works for this session.
    }
  }

  /** Open when you last left it open, or when the page you are on is inside it. */
  function isOpen(group: NavGroup): boolean {
    if (!group.label) return true
    const remembered = openState?.[group.label]
    if (remembered !== undefined) return remembered
    return group.items.some((i) => i.href === active)
  }

  return (
    <>
      {/* Mobile: one horizontally-scrolling row. Collapsible groups would cost
          a tap and a row of chrome to hide four links, so the groups are only
          labels here. */}
      <nav className="flex items-center gap-0.5 overflow-x-auto border-t border-border-subtle p-2 md:hidden">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? 'root'} className="flex items-center gap-0.5">
            {group.label && (
              <span className="whitespace-nowrap pl-2 pr-1 text-[10px] uppercase tracking-wide text-muted-2">
                {group.label}
              </span>
            )}
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} active={item.href === active} />
            ))}
          </div>
        ))}
      </nav>

      {/* Desktop: a collapsible group per vertical. */}
      <nav className="hidden flex-1 flex-col p-2 md:flex">
        {NAV_GROUPS.map((group) => {
          if (!group.label) {
            return (
              <div key="root" className="flex flex-col">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === active} />
                ))}
              </div>
            )
          }

          const open = isOpen(group)
          return (
            <div key={group.label} className="mt-3 flex flex-col first:mt-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(group.label!, !open)}
                className="flex items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <span>{group.label}</span>
                <span aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`}>
                  ›
                </span>
              </button>
              {open && (
                <div className="flex flex-col">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} active={item.href === active} indent />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </>
  )
}

function NavLink({ item, active, indent }: { item: NavItem; active: boolean; indent?: boolean }) {
  return (
    <Link
      href={item.href}
      className={`block whitespace-nowrap rounded-md py-2 text-sm transition-colors ${
        indent ? 'pl-5 pr-3' : 'px-3'
      } ${active ? 'bg-surface-2 font-medium text-foreground' : 'text-muted hover:bg-surface-2 hover:text-foreground'}`}
    >
      {item.label}
    </Link>
  )
}
