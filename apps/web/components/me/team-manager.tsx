'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PROGRAM_OPTIONS, ROLE_OPTIONS, programLabel, roleLabel } from './team-labels'

/**
 * Your teams, each one opening into its grant profile.
 *
 * The two things a card can carry come from two different places and must stay
 * that way. `role` comes from a claim on accounts.userTeams, which is
 * self-asserted and only changes what this user sees. `profileId` and `canEdit`
 * come from a team_profile_members row and are the only reason any profile
 * data is on this page at all. The server builds the cards; this file only
 * lays them out, so there is no way for a claim to talk itself into a profile
 * here either.
 *
 * Every action is a server action passed in from the page, so this holds no
 * data access and no ownership check can be skipped from the client. Errors
 * come back as values rather than thrown, which is what lets the row show a
 * message instead of tripping the error boundary.
 */

export interface TeamCard {
  /** program:teamNumber, stable across both sources. */
  key: string
  program: string
  teamNumber: number
  /** userTeams row id, or null when only a profile membership puts this team here. */
  claimId: string | null
  role: string | null
  /** Set only when the user is a member of this team's profile. */
  profileId: string | null
  canEdit: boolean
  /** A profile exists and this user is not on it. */
  takenByOthers: boolean
}

export function TeamManager({
  cards,
  openProfileId,
  collapsible,
  addAction,
  removeAction,
  createProfileAction,
  children,
}: {
  cards: TeamCard[]
  openProfileId: string | null
  /** False when there is only one profile, which has nothing to collapse back to. */
  collapsible: boolean
  addAction: (formData: FormData) => Promise<{ error?: string }>
  removeAction: (id: string) => Promise<{ error?: string }>
  createProfileAction: (formData: FormData) => Promise<{ error?: string; profileId?: string }>
  /** The open profile, rendered on the server and slotted into its own card. */
  children: React.ReactNode
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  /**
   * Two slots, not one. The add form sits below the list, so a single message
   * would land nowhere near whichever control the user actually used.
   */
  const [listError, setListError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    setAddError(null)
    start(async () => {
      const res = await addAction(data)
      if (res.error) {
        setAddError(res.error)
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

  function onRemove(claimId: string) {
    setListError(null)
    start(async () => {
      const res = await removeAction(claimId)
      if (res.error) setListError(res.error)
      router.refresh()
    })
  }

  function onStartProfile(card: TeamCard) {
    setListError(null)
    const data = new FormData()
    data.set('program', card.program)
    data.set('teamNumber', String(card.teamNumber))
    start(async () => {
      const res = await createProfileAction(data)
      if (res.error) {
        setListError(res.error)
        return
      }
      // Land on the new profile open rather than closed one click away.
      router.replace(res.profileId ? `/me/team?p=${res.profileId}` : '/me/team')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        {cards.length === 0 ? (
          <p className="rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
            No teams yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cards.map((card) => {
              const open = card.profileId !== null && card.profileId === openProfileId
              const claimId = card.claimId
              return (
                <li key={card.key} className="rounded-lg border border-border-subtle bg-surface">
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <span className="w-16 text-lg font-semibold tabular-nums text-foreground">
                      {card.teamNumber}
                    </span>
                    <Badge variant="program">{programLabel(card.program)}</Badge>
                    {card.role && <Badge variant="muted">{roleLabel(card.role)}</Badge>}

                    <div className="ml-auto flex items-center gap-2">
                      {card.profileId ? (
                        <ProfileToggle
                          profileId={card.profileId}
                          open={open}
                          collapsible={collapsible}
                          teamNumber={card.teamNumber}
                        />
                      ) : card.takenByOthers ? (
                        <span className="max-w-sm text-right text-xs text-muted-2">
                          Someone on this team set up its profile. Ask them to add you.
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onStartProfile(card)}
                          disabled={pending}
                          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
                        >
                          {pending ? 'Working…' : 'Start profile'}
                        </button>
                      )}

                      {claimId && (
                        <button
                          type="button"
                          onClick={() => onRemove(claimId)}
                          disabled={pending}
                          aria-label={`Remove team ${card.teamNumber}`}
                          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {/* "Remove claim" only where the two can come apart:
                              the claim goes, the profile membership stays, and
                              the row with it. Naming what leaves beats a
                              paragraph under every row explaining it. */}
                          {card.profileId ? 'Remove claim' : 'Remove'}
                        </button>
                      )}
                    </div>
                  </div>


                  {open && <div className="border-t border-border-subtle p-3 sm:p-5">{children}</div>}
                </li>
              )
            })}
          </ul>
        )}

        {listError && (
          <p role="alert" className="mt-3 text-sm text-frc">
            {listError}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Add a team</h2>
        <form
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
        {addError && (
          <p role="alert" className="mt-3 text-sm text-frc">
            {addError}
          </p>
        )}

        <p className="mt-3 max-w-2xl text-sm text-muted-2">
          Claimed teams are not verified and give you no control over a team&apos;s listings, photos or
          fields.
        </p>
      </section>
    </div>
  )
}

/**
 * Open or close a profile.
 *
 * A link, not a button, so the open profile is in the URL: a mentor on three
 * teams can bookmark the one they actually edit. scroll={false} keeps the page
 * where it is, since the card being opened is already under the cursor.
 */
function ProfileToggle({
  profileId,
  open,
  collapsible,
  teamNumber,
}: {
  profileId: string
  open: boolean
  collapsible: boolean
  teamNumber: number
}) {
  if (open && !collapsible) return null

  const href = open ? '/me/team' : `/me/team?p=${profileId}`
  return (
    <Link
      href={href}
      scroll={false}
      aria-expanded={open}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-primary transition-colors hover:bg-surface-2"
    >
      {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      {open ? 'Close' : 'Profile'}
      <span className="sr-only"> for team {teamNumber}</span>
    </Link>
  )
}
