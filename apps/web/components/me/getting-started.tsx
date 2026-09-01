import { ArrowUpRight, Bookmark } from 'lucide-react'
import { VERTICALS } from './vertical-links'

/**
 * What a brand new account sees instead of four empty headings.
 *
 * Saving is invisible until you have done it once, so this says plainly what
 * the bookmark does and then hands the visitor a way into each of the four
 * verticals. Shown only when the account has nothing saved at all.
 */
export function GettingStarted() {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <Bookmark className="mt-1 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Nothing saved yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Anywhere on The Tool Pit you can save a tool, an event, a practice field or a grant. Everything
            you save lands on this page, so you get one list across all four sites instead of four sets of
            browser bookmarks. Saving a grant also means we can tell you before its deadline.
          </p>
        </div>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {VERTICALS.map((v) => (
          <li key={v.key}>
            <a
              href={v.href}
              className="flex h-full flex-col gap-1 rounded-lg border border-border-subtle bg-background p-4 transition-colors hover:bg-surface-2"
            >
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {v.name}
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-2" />
              </span>
              <span className="text-sm text-muted">{v.blurb}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
