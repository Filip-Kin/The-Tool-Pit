import Link from 'next/link'
import { Camera, MapPin, CircleDollarSign, Code2, CalendarDays, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

/**
 * The frc.tools verticals, surfaced in search.
 *
 * Photos, Fields, Grants, Robot Code / CAD and Offseason Events are separate
 * apps at /photos, /fields, /grants, /robot-code and /events, not rows in the
 * tools table. A veteran searched for "practice fields" and "grants" and got
 * nothing, because the search index only knows tools. This block answers that:
 * when the query names a vertical or its purpose, the vertical shows up ABOVE
 * the tool results as its own section, never faked as a tool card.
 *
 * WHY THE LIST IS COPIED HERE. The canonical set is VERTICALS in
 * components/layout/vertical-switcher.tsx, but that const is not exported and
 * the file is owned elsewhere. The five below are the non-tools verticals (the
 * tools vertical IS the search page, so it is never a "go here instead"
 * result). Keywords are the words a person types when they mean that vertical
 * rather than a tool. Keep them in sync if a vertical is added.
 */
interface VerticalMatch {
  key: string
  label: string
  href: string
  blurb: string
  Icon: typeof Camera
  keywords: string[]
}

const VERTICAL_MATCHES: VerticalMatch[] = [
  {
    key: 'photos',
    label: 'Photos',
    href: '/photos',
    blurb: 'Event photo albums, by event and team',
    Icon: Camera,
    keywords: ['photo', 'photos', 'album', 'albums', 'picture', 'pictures', 'image', 'images', 'gallery'],
  },
  {
    key: 'fields',
    label: 'Fields',
    href: '/fields',
    blurb: 'A map of practice fields you can visit',
    Icon: MapPin,
    keywords: ['field', 'fields', 'practice', 'practice field', 'practice fields'],
  },
  {
    key: 'grants',
    label: 'Grants',
    href: '/grants',
    blurb: 'Grants and funding your team can apply for',
    Icon: CircleDollarSign,
    keywords: ['grant', 'grants', 'funding', 'fund', 'sponsor', 'sponsorship', 'financial'],
  },
  {
    key: 'code',
    label: 'Robot Code / CAD',
    href: '/robot-code',
    blurb: 'Team robot code and CAD, by team and season',
    Icon: Code2,
    keywords: ['robot code', 'robot-code', 'cad', 'onshape', 'grabcad', 'source code', 'codebase'],
  },
  {
    key: 'events',
    label: 'Offseason Events',
    href: '/events',
    blurb: 'Off-season competitions on a map, upcoming first',
    Icon: CalendarDays,
    keywords: ['event', 'events', 'offseason', 'off-season', 'off season', 'competition', 'competitions'],
  },
]

/**
 * Verticals whose keywords appear in the query, as whole words.
 *
 * Whole-word so "code" does not match inside "encoder" and "field" does not
 * fire on "shielding". Empty for a query that names no vertical, which is the
 * common case: an unrelated search shows no block at all.
 */
export function matchVerticals(query: string): VerticalMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return VERTICAL_MATCHES.filter((v) =>
    v.keywords.some((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(q)),
  )
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The matched verticals as a section above the tool results.
 *
 * Renders nothing when no vertical matches, so the caller can drop it in
 * unconditionally and an unrelated search stays clean.
 */
export function VerticalMatches({ query, className }: { query: string; className?: string }) {
  const matches = matchVerticals(query)
  if (matches.length === 0) return null

  return (
    <section aria-label="Matching frc.tools sites" className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-2">
        Elsewhere on frc.tools
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map(({ key, label, href, blurb, Icon }) => (
          <Link
            key={key}
            href={href}
            className="group relative flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:border-primary hover:bg-primary/10"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1 font-semibold text-foreground">
                {label}
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-2 transition-colors group-hover:text-primary" aria-hidden />
              </span>
              <span className="text-sm text-muted">{blurb}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
