'use client'

import { Card } from '@/components/ui/card'
import { useSession } from '@/components/auth/session-provider'

/**
 * "This is not mine, I am just passing it along."
 *
 * ONE CHECKBOX, ONE WORDING, six forms. Submitting something while signed in is
 * what makes you its owner once a moderator approves it, and this is how you
 * decline that. It is the only control on any public form whose meaning is
 * "do not give me this", so it says so in those words rather than in ours.
 *
 * SIGNED OUT, IT IS NOT RENDERED. There is nothing to decline: an anonymous
 * submission cannot be attached to an account, which is the whole reason
 * anonymous submission is allowed to stay open. Putting a dead checkbox in
 * front of a signed-out person would read as a sign-in wall, and there are
 * none of those on this site.
 *
 * It starts UNTICKED on every form. Anything you submit while signed in is
 * yours once a moderator approves it, whatever the vertical, and this is how
 * you say it is not. The default is still read from
 * lib/listings/passing-along.ts rather than written here, because the server
 * has to fall back to the same value when a form fails to post one.
 */
export function PassingAlongCheckbox({
  checked,
  onChange,
  noun,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** What this vertical calls the thing, lower case: "practice field", "album". */
  noun: string
}) {
  const { user, loading } = useSession()
  if (loading || !user) return null

  return (
    <Card pad="sm">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
        />
        <span className="text-sm text-foreground">
          This {noun} is not mine, I am just passing it along
          <span className="mt-0.5 block text-xs text-muted">
            {checked
              ? `Nothing is listed under your account. Whoever runs this ${noun} can claim it later.`
              : `Once it is approved it appears under Listings and you can edit it yourself.`}
          </span>
        </span>
      </label>
    </Card>
  )
}
