'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { AdminQueueCounts } from '@/lib/admin/queue-counts'

/**
 * Admin navigation: the verticals down the side, each with the same slots.
 *
 * Every vertical gets Submissions, Candidates, Crawl jobs, one link per
 * published-side status, and Sources, in that order, because that is the order
 * a queue is worked: what people sent us, what a crawler found, whether the
 * crawler ran, the live listings by status, and the knobs. A vertical that
 * genuinely has no page for a slot omits it rather than linking somewhere that
 * 404s.
 *
 * STATUS LIVES HERE, NOT ON THE PAGE. Each list page used to carry its own
 * Pending / Published / Suppressed / All tab bar, which repeated this
 * navigation and, on a page whose bare path is already the Submissions queue,
 * showed a Pending tab that was always empty and read as a bug. Published and
 * Suppressed (and the album views) are their own links here now, and each page
 * renders the one list its URL asks for.
 *
 * Crawl jobs is one page with a vertical filter, not five pages. The five job
 * tables have identical columns and the overnight sweeps all land within two
 * hours of each other, so the answer to "did anything run last night" is one
 * screen.
 *
 * THE BADGES. Each queue page used to carry its own strip of status tabs that
 * repeated these links and put a count on them, so the same navigation existed
 * twice and only the copy nobody had chosen said how much was waiting. The
 * counts belong here, on the link you actually navigate with. They are resolved
 * once for the whole sidebar in the layout, never per entry.
 *
 * A zero renders nothing. A queue at zero is the normal state and a row of
 * badges saying 0 reads as a wall of alarms that all mean "fine".
 */

interface NavItem {
  href: string
  label: string
  /** The queue behind this link, when it has one. Nothing else gets a badge. */
  queue?: keyof AdminQueueCounts
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
      { href: '/admin/submissions', label: 'Submissions', queue: 'toolSubmissions' },
      { href: '/admin/candidates', label: 'Candidates', queue: 'toolCandidates' },
      { href: '/admin/crawls?vertical=tools', label: 'Crawl jobs' },
      { href: '/admin/tools', label: 'Published' },
      { href: '/admin/tools?status=draft', label: 'Draft' },
      { href: '/admin/tools?status=suppressed', label: 'Suppressed' },
      { href: '/admin/sources', label: 'Sources' },
      { href: '/admin/votes', label: 'Votes' },
    ],
  },
  {
    label: 'Photos',
    items: [
      { href: '/admin/album-submissions', label: 'Submissions' },
      { href: '/admin/album-candidates', label: 'Candidates', queue: 'albumCandidates' },
      { href: '/admin/album-candidates?status=unmatched', label: 'Needs event' },
      { href: '/admin/album-candidates?status=no_cover', label: 'No cover' },
      { href: '/admin/album-candidates?status=published', label: 'Published' },
      { href: '/admin/album-candidates?status=suppressed', label: 'Suppressed' },
      { href: '/admin/crawls?vertical=photos', label: 'Crawl jobs' },
      { href: '/admin/album-sources', label: 'Sources' },
    ],
  },
  {
    label: 'Off-season events',
    items: [
      { href: '/admin/event-listings', label: 'Submissions', queue: 'eventSubmissions' },
      { href: '/admin/event-listings/candidates', label: 'Candidates', queue: 'eventCandidates' },
      { href: '/admin/event-edits', label: 'Suggested edits', queue: 'eventEdits' },
      { href: '/admin/crawls?vertical=events', label: 'Crawl jobs' },
      { href: '/admin/event-listings?status=published', label: 'Published' },
      { href: '/admin/event-listings?status=suppressed', label: 'Suppressed' },
      { href: '/admin/event-listings/sources', label: 'Sources' },
    ],
  },
  {
    label: 'Practice fields',
    items: [
      { href: '/admin/practice-fields', label: 'Submissions', queue: 'fieldSubmissions' },
      { href: '/admin/practice-fields/candidates', label: 'Candidates', queue: 'fieldCandidates' },
      { href: '/admin/crawls?vertical=fields', label: 'Crawl jobs' },
      { href: '/admin/practice-fields?status=published', label: 'Published' },
      { href: '/admin/practice-fields?status=suppressed', label: 'Suppressed' },
      { href: '/admin/practice-fields/sources', label: 'Sources' },
      { href: '/admin/field-edits', label: 'Suggested edits', queue: 'fieldEdits' },
    ],
  },
  {
    label: 'Grants',
    items: [
      { href: '/admin/grants/candidates', label: 'Candidates', queue: 'grantCandidates' },
      { href: '/admin/crawls?vertical=grants', label: 'Crawl jobs' },
      { href: '/admin/grants', label: 'Published' },
      { href: '/admin/grants?status=pending', label: 'Pending' },
      { href: '/admin/grants?status=unverified', label: 'Unverified' },
      { href: '/admin/grants?status=suppressed', label: 'Suppressed' },
      { href: '/admin/grants?status=archived', label: 'Archived' },
      { href: '/admin/grants/sources', label: 'Sources' },
      { href: '/admin/grants/changes', label: 'Changes', queue: 'grantChanges' },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { href: '/admin/users', label: 'Users' },
      { href: '/admin/claims', label: 'Listing claims', queue: 'listingClaims' },
    ],
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
 * Submissions and Published links. The item with the most query parameters
 * that all match wins, so `?status=published` highlights Published and a bare
 * path highlights Submissions.
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

export function AdminNav({ counts }: { counts: AdminQueueCounts }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const active = activeHref(pathname, search)

  const waiting = (item: NavItem) => (item.queue ? counts[item.queue] : 0)

  const [menuOpen, setMenuOpen] = useState(false)

  // The label of the page you are on, shown next to the hamburger so a shut
  // menu still tells you where you are.
  const activeLabel =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === active)?.label ?? 'Overview'

  const totalWaiting = NAV_GROUPS.reduce(
    (sum, group) => sum + group.items.reduce((n, item) => n + (item.queue ? counts[item.queue] : 0), 0),
    0,
  )

  // Shut the panel on a route change, so tapping a link does not leave it open
  // over the page it just opened.
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname, search])

  // Escape closes it, and the page behind does not scroll while it is open.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [menuOpen])

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
      {/* Mobile: a hamburger and a panel.
          
          It was one horizontally-scrolling row of every link in the admin,
          about thirty of them, so reaching the practice-field queue meant
          dragging sideways through four verticals at 10px labels. A row that
          scrolls also hides how much is in it: there is no way to tell from
          looking whether anything is off to the right. */}
      <div className="flex items-center gap-2 border-t border-border-subtle px-2 py-2 md:hidden">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="admin-mobile-nav"
          onClick={() => setMenuOpen(true)}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
        >
          <span aria-hidden className="flex flex-col gap-[3px]">
            <span className="block h-0.5 w-4 rounded-full bg-current" />
            <span className="block h-0.5 w-4 rounded-full bg-current" />
            <span className="block h-0.5 w-4 rounded-full bg-current" />
          </span>
          Menu
          {/* The total, so a closed menu never hides work. */}
          <QueueBadge count={totalWaiting} tone="loud" />
        </button>

        {/* Where you are, since the panel is shut. */}
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{activeLabel}</span>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" id="admin-mobile-nav">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/60"
          />

          <nav className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col overflow-y-auto border-r border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Admin</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="flex flex-col gap-4 p-3">
              {NAV_GROUPS.map((group) => (
                <div key={group.label ?? 'root'} className="flex flex-col gap-0.5">
                  {group.label && (
                    <span className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                      {group.label}
                    </span>
                  )}
                  {group.items.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      active={item.href === active}
                      count={waiting(item)}
                      onNavigate={() => setMenuOpen(false)}
                      big
                    />
                  ))}
                </div>
              ))}
            </div>
          </nav>
        </div>
      )}

      {/* Desktop: a collapsible group per vertical. */}
      <nav className="hidden flex-1 flex-col p-2 md:flex">
        {NAV_GROUPS.map((group) => {
          if (!group.label) {
            return (
              <div key="root" className="flex flex-col">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === active} count={waiting(item)} />
                ))}
              </div>
            )
          }

          const open = isOpen(group)
          // Collapsed, the group's own badges are hidden, so it carries their
          // total. Without it a closed group is a place work can pile up
          // unseen, which is the one thing the badges exist to prevent.
          const groupWaiting = group.items.reduce((sum, item) => sum + waiting(item), 0)
          return (
            <div key={group.label} className="mt-3 flex flex-col first:mt-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(group.label!, !open)}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <span>{group.label}</span>
                {!open && <QueueBadge count={groupWaiting} />}
                <span aria-hidden className={`ml-auto transition-transform ${open ? 'rotate-90' : ''}`}>
                  ›
                </span>
              </button>
              {open && (
                <div className="flex flex-col">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} active={item.href === active} count={waiting(item)} indent />
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

function NavLink({
  item,
  active,
  count,
  indent,
  big,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  count: number
  indent?: boolean
  /** Touch-sized row for the mobile panel. */
  big?: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-2 whitespace-nowrap rounded-md transition-colors ${
        big ? 'px-3 py-3 text-[15px]' : 'py-2 text-sm'
      } ${indent ? 'pl-5 pr-3' : big ? '' : 'px-3'} ${
        active
          ? 'bg-primary/15 font-semibold text-primary'
          : // text-foreground, not text-muted. The old muted grey on the panel
            // background is the poor contrast: it is a navigation label, not a
            // caption, and it has to be readable on a phone in daylight.
            'text-foreground hover:bg-surface-2'
      }`}
    >
      {item.label}
      <QueueBadge count={count} tone={active ? 'loud' : undefined} />
    </Link>
  )
}

/**
 * Nothing at all below one. Pushed right with ml-auto so the numbers line up
 * down the sidebar instead of trailing each label at a different indent.
 */
function QueueBadge({ count, tone }: { count: number; tone?: 'loud' }) {
  if (count < 1) return null
  return (
    <span
      className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        tone === 'loud' ? 'bg-primary/25 text-primary' : 'bg-surface-3 text-foreground'
      }`}
    >
      {count > 999 ? '999+' : count}
      <span className="sr-only"> waiting</span>
    </span>
  )
}
