import { CircleAlert, Info } from 'lucide-react'
import type { PublicGrantRequirement } from '@/lib/grants/grant-display'
import { REQUIREMENT_KIND_LABEL } from '@/lib/grants/grant-display'

/**
 * Eligibility, split the way a team reads it: what can rule you out, and what
 * is worth knowing before you spend an evening on the form.
 *
 * The split is `isBlocking`, not the requirement kind. The schema is explicit
 * that a rule which cannot be tested goes in as kind 'other' with isBlocking
 * false, and those must never read like a hard gate.
 */
export function GrantRequirements({ requirements }: { requirements: PublicGrantRequirement[] }) {
  if (requirements.length === 0) {
    return (
      <p className="text-sm text-muted-2">
        Nobody has written up the eligibility rules for this grant yet. Read the funder&apos;s own page before
        you start.
      </p>
    )
  }

  const blocking = requirements.filter((r) => r.isBlocking)
  const context = requirements.filter((r) => !r.isBlocking)

  return (
    <div className="flex flex-col gap-5">
      {blocking.length > 0 && (
        <RequirementList
          title="You have to meet these"
          hint="Fail one of these and the application will not be considered."
          icon={<CircleAlert className="h-4 w-4 text-official" aria-hidden />}
          requirements={blocking}
        />
      )}
      {context.length > 0 && (
        <RequirementList
          title="Worth knowing"
          hint="Not a hard gate, but it shapes how strong an application will be."
          icon={<Info className="h-4 w-4 text-muted-2" aria-hidden />}
          requirements={context}
        />
      )}
    </div>
  )
}

function RequirementList({
  title,
  hint,
  icon,
  requirements,
}: {
  title: string
  hint: string
  icon: React.ReactNode
  requirements: PublicGrantRequirement[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="text-xs text-muted-2">{hint}</p>
      <ul className="flex flex-col gap-2">
        {requirements.map((r) => (
          <li key={r.id} className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-surface p-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-2">
              {REQUIREMENT_KIND_LABEL[r.kind]}
            </span>
            {/* The funder's own words. We never paraphrase eligibility. */}
            <span className="text-sm text-foreground">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
