/**
 * "Created by Filip Kin", site wide.
 *
 * One component rather than the same markup copied into six footers, because
 * the per-vertical footers have already drifted apart once and a credit line
 * that says something different on /grants than on /photos would be worse than
 * none at all.
 */
export function SiteCredit({ className }: { className?: string }) {
  return (
    <span className={className}>
      Created by{' '}
      <a
        href="https://filipkin.com"
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
      >
        Filip Kin
      </a>
    </span>
  )
}
