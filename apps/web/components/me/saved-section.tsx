import { ArrowUpRight } from 'lucide-react'
import { resolveFavoriteHref } from './vertical-links'

/**
 * One saved thing, as getFavoritesForUser() returns it.
 *
 * Declared here rather than imported from lib/queries/favorites so these
 * components stay renderable on their own, and so a change to the query's
 * internals does not ripple into the markup. `createdAt` is typed loosely
 * because it arrives as a Date from the driver but as a string once it has
 * crossed a serialisation boundary, and `imageUrl` accepts both empties so a
 * FavoriteItem drops in without a cast.
 */
export interface SavedItem {
  id: string
  entityType: string
  entityId: string
  title: string
  subtitle: string | null
  href: string
  imageUrl?: string | null
  createdAt: Date | string
}

/**
 * A titled group of saved items.
 *
 * Renders NOTHING when the group is empty. The page decides what an entirely
 * empty account looks like, so an empty section here would only leave a hole
 * between two full ones.
 */
export function SavedSection({
  title,
  description,
  items,
  browseHref,
  browseLabel,
}: {
  title: string
  description: string
  items: SavedItem[]
  browseHref: string
  browseLabel: string
}) {
  if (items.length === 0) return null

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">
            {title}
            <span className="ml-2 text-sm font-normal text-muted-2">{items.length}</span>
          </h2>
          <p className="text-sm text-muted">{description}</p>
        </div>
        <VerticalLinkOut href={browseHref} label={browseLabel} />
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <SavedCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function VerticalLinkOut({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex shrink-0 items-center gap-1 text-sm text-primary transition-colors hover:text-primary-hover"
    >
      {label}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </a>
  )
}

function SavedCard({ item }: { item: SavedItem }) {
  const href = resolveFavoriteHref(item.entityType, item.href)

  return (
    // A plain anchor, not next/link: most of these cross a subdomain, where a
    // client-side navigation would be wrong anyway.
    <a
      href={href}
      className="flex h-full items-start gap-3 rounded-lg border border-border-subtle bg-surface p-3 transition-colors hover:bg-surface-2"
    >
      {item.imageUrl ? (
        // Covers and logos come from arbitrary external hosts, so a plain img
        // avoids adding every one of them to next/image remotePatterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          className="h-12 w-12 shrink-0 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-surface-3 text-sm font-semibold text-muted-2"
        >
          {item.title.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{item.title}</span>
        {item.subtitle && <span className="mt-0.5 block truncate text-xs text-muted">{item.subtitle}</span>}
      </span>
    </a>
  )
}
