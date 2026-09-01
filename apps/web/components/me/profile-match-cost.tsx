import { AlertCircle, ArrowDown, CheckCircle2, Clock } from 'lucide-react'
import { profileFieldLabel } from './profile-fields'

/**
 * "What an empty box is costing you".
 *
 * A progress bar says 61%. This says eleven grants are sitting unmatched
 * because nobody has ticked Title I, and names three of them. That is the
 * sentence that gets the box ticked, and it is the whole reason the matcher
 * keeps 'missing_info' as a verdict instead of quietly showing fewer grants.
 *
 * Structural props rather than an import of the query module's types: this
 * component renders whatever the page hands it and has no idea how the numbers
 * were counted.
 */

export interface FieldCost {
  /** team_profiles column name, as the matcher writes it into missingFields. */
  field: string
  grantCount: number
  examples: string[]
}

/** How many fields to list before collapsing the rest into a count. */
const DISPLAY_LIMIT = 5

export function ProfileMatchCost({
  costs,
  missingInfoCount,
  actionableCount,
  neverMatched,
}: {
  costs: FieldCost[]
  missingInfoCount: number
  actionableCount: number
  /** No matches computed for this profile yet, so there is nothing to report. */
  neverMatched: boolean
}) {
  if (neverMatched) {
    return (
      <Panel icon={<Clock className="h-4 w-4 text-muted-2" />} title="No matches worked out yet">
        <p className="text-sm text-muted">
          Matching runs on a schedule, so a profile saved in the last few minutes has no results yet.
        </p>
      </Panel>
    )
  }

  if (costs.length === 0) {
    return (
      <Panel icon={<CheckCircle2 className="h-4 w-4 text-rookie" />} title="Nothing is blocked on your profile">
        <p className="text-sm text-muted">
          {actionableCount === 0
            ? 'No live matches for your team either, which usually means nothing in the catalogue is open in your area yet.'
            : `All ${actionableCount} of your live match${actionableCount === 1 ? '' : 'es'} could be worked out from what you have filled in.`}
        </p>
      </Panel>
    )
  }

  const shown = costs.slice(0, DISPLAY_LIMIT)
  const hiddenFields = costs.length - shown.length

  return (
    <Panel
      icon={<AlertCircle className="h-4 w-4 text-official" />}
      title={`${missingInfoCount} grant${missingInfoCount === 1 ? '' : 's'} need${missingInfoCount === 1 ? 's' : ''} something you have not filled in`}
    >
      <p className="text-sm text-muted">
        Published grants we cannot rule in or out for your team yet. One field often unblocks several.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {shown.map((cost) => (
          <li
            key={cost.field}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-surface-2 px-3 py-2"
          >
            <span className="font-medium text-foreground">{profileFieldLabel(cost.field)}</span>
            <span className="text-sm text-official">
              {cost.grantCount} grant{cost.grantCount === 1 ? '' : 's'}
            </span>
            {cost.examples.length > 0 && (
              <span className="text-xs text-muted-2">
                {cost.examples.join(', ')}
                {cost.grantCount > cost.examples.length && ` and ${cost.grantCount - cost.examples.length} more`}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* No silent caps: say out loud that the list is a subset. */}
      {hiddenFields > 0 && (
        <p className="mt-2 text-xs text-muted-2">
          And {hiddenFields} more field{hiddenFields === 1 ? '' : 's'} with fewer grants behind them.
        </p>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-2">
        <ArrowDown className="h-3 w-3" />
        Each is marked in the form below.
      </p>
    </Panel>
  )
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4 sm:p-5">
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}
