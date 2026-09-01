import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

/**
 * The one button.
 *
 * An audit of the codebase found six different primary button sizes in use:
 * px-4 py-2 text-sm (21 places), px-3 py-1.5 text-sm (10), px-3 py-1.5 text-xs
 * (5), px-5 py-2.5, px-3 py-2 and px-2.5 py-1.5. None of that was a decision.
 * Each vertical was built at a different time and copied whatever was nearest,
 * which is exactly what makes six verticals read as six different sites.
 *
 * Two sizes, because two is what the app actually needs: `md` for a call to
 * action on a page, `sm` for one in a header or on a card. Those are the two
 * majority values already in use, so most call sites are a rename rather than a
 * visual change.
 *
 * Renders an <a> when given href, a <button> otherwise, so a link never has to
 * be dressed up as a button by hand. That is where the missing cursor and the
 * missing focus ring kept coming from.
 */

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'border border-border text-foreground hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-foreground',
}

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
}

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-40'

type CommonProps = {
  variant?: Variant
  size?: Size
  className?: string
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...rest}>
      {children}
    </button>
  )
}

/**
 * The same shape as a link. `external` opens in a new tab with the rel that
 * has to go with it; internal links go through next/link so client navigation
 * still works.
 */
export function ButtonLink({
  href,
  external = false,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: CommonProps & { href: string; external?: boolean }) {
  const classes = cn(BASE, VARIANT[variant], SIZE[size], className)
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  )
}
