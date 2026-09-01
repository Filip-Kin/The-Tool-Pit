'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PROGRAM_OPTIONS, ROLE_OPTIONS, programLabel, roleLabel } from './team-labels'
import type { TeamRow } from './teams-summary'

/**
 * Add and remove team memberships.
 *
 * Both actions are server actions passed in from the page, so this file holds
 * no data access and the ownership check cannot be skipped from the client.
 * Errors come back as a value rather than a thrown exception, which is what
 * lets the form show a message instead of tripping the error boundary.
 */
export function TeamManager({
  teams,
  addAction,
  removeAction,
}: {
  teams: TeamRow[]
  addAction: (formData: FormData) => Promise<{ error?: string }>
  removeAction: (id: string) => Promise<{ error?: string }>
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    setError(null)
    start(async () => {
      const res = await addAction(data)
      if (res.error) {
        setError(res.error)
        return
      }
      // Keep the program and role choices, clear the number: adding two teams
      // in a row is nearly always the same person in the same role. Reset by
      // hand rather than form.reset(), which would also throw away the selects.
      const numberInput = form.querySelector<HTMLInputElement>('input[name="teamNumber"]')
      if (numberInput) {
        numberInput.value = ''
        numberInput.focus()
      }
      router.refresh()
    })
  }

  function onRemove(id: string) {
    setError(null)
    start(async () => {
      const res = await removeAction(id)
      if (res.error) setError(res.error)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-lg font-semibold text-foreground">Add a team</h2>
        <form
          ref={formRef}
          onSubmit={onSubmit}
          className="mt-4 flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4 sm:flex-row sm:items-end"
        >
          <label className="flex flex-col gap-1.5 sm:w-28">
            <span className="text-xs font-medium text-muted">Program</span>
            <select name="program" defaultValue="frc" className="input">
              {PROGRAM_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {programLabel(p)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 sm:w-40">
            <span className="text-xs font-medium text-muted">Team number</span>
            <input
              name="teamNumber"
              type="number"
              min={1}
              step={1}
              required
              inputMode="numeric"
              placeholder="3538"
              className="input"
            />
          </label>

          <label className="flex flex-col gap-1.5 sm:w-44">
            <span className="text-xs font-medium text-muted">Your role</span>
            <select name="role" defaultValue="student" className="input">
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40 sm:ml-auto"
          >
            {pending ? 'Saving…' : 'Add team'}
          </button>
        </form>
        {/* role=alert so a screen reader hears a rejected number, since the
            only other signal is the row not appearing. */}
        {error && (
          <p role="alert" className="mt-3 text-sm text-frc">
            {error}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">
          Your teams
          {teams.length > 0 && <span className="ml-2 text-sm font-normal text-muted-2">{teams.length}</span>}
        </h2>

        {teams.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
            No teams yet. Add one above and your saved items, grant matches and event photos start being
            filtered to teams you care about.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {teams.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3"
              >
                <span className="w-16 text-lg font-semibold tabular-nums text-foreground">{t.teamNumber}</span>
                <Badge variant="program">{programLabel(t.program)}</Badge>
                <Badge variant="muted">{roleLabel(t.role)}</Badge>
                <button
                  type="button"
                  onClick={() => onRemove(t.id)}
                  disabled={pending}
                  aria-label={`Remove team ${t.teamNumber}`}
                  className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
