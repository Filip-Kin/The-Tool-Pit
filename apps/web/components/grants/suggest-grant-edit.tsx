'use client'

import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSession } from '@/components/auth/session-provider'

/**
 * "Suggest an edit" for a grant. Accountless, like the event and field
 * forms, and in the same dialog those use. Every fact the page shows is a
 * field here, prefilled with what the page says, so a visitor changes the
 * one thing they know and leaves the rest. It all lands in the admin change
 * queue with the link they point to as evidence; nothing changes on the page
 * until a person applies it.
 */
export interface SuggestGrantEditProps {
  grantId: string
  current: {
    name: string
    funderName: string | null
    summary: string | null
    description: string | null
    infoUrl: string
    applicationUrl: string | null
    programs: string[]
    geoScope: string
    countries: string[]
    regions: string[]
    localityNote: string | null
    awardMin: number | null
    awardMax: number | null
    awardCurrency: string
    awardNotes: string | null
    renewable: boolean | null
    deadlineType: string
    effortLevel: string
    nextDeadline: string | null
    nextOpens: string | null
  }
}

const OPEN_EVENT = 'grant-suggest-open'

export function SuggestGrantEdit({ grantId, current }: SuggestGrantEditProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focusField, setFocusField] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  // An admin's edit is saved straight to the listing (the server applies it
  // and skips the queue), so the dialog asks for no citation and says so.
  const { user } = useSession()
  const admin = user?.isAdmin === true

  // "Know the deadline? Tell us" beside a blank fact opens this dialog on that field.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setFocusField((e as CustomEvent<{ field?: string }>).detail?.field ?? null)
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])
  useEffect(() => {
    if (!open || !focusField) return
    const t = setTimeout(() => {
      const el = formRef.current?.querySelector<HTMLElement>(`[name="${focusField}"]`)
      el?.focus()
      el?.scrollIntoView({ block: 'center' })
    }, 50)
    return () => clearTimeout(t)
  }, [open, focusField])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/grants/${grantId}/suggest`, { method: 'POST', body: new FormData(e.currentTarget) })
      const data = (await res.json()) as { ok?: boolean; error?: string; filed?: number }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not send that.')
        return
      }
      setDone(admin ? `Saved. ${data.filed} change${data.filed === 1 ? '' : 's'} applied to the listing.` : `Thanks. ${data.filed} change${data.filed === 1 ? '' : 's'} sent for review. It shows on the page once a person has checked it.`)
      if (admin) setTimeout(() => window.location.reload(), 800)
    } catch {
      setError('Could not send that. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" id="suggest-edit" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Suggest an edit
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[2001] max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-surface p-6 shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-foreground">Suggest an edit</Dialog.Title>
              <p className="mt-1 text-sm text-muted">{admin ? 'Change what you know and leave the rest. Saved straight to the listing.' : 'Change what you know and leave the rest. A person checks it before it goes live.'}</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="rounded-md p-1 text-muted hover:text-foreground" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {done ? (
            <p className="text-sm text-foreground">{done}</p>
          ) : (
            <form ref={formRef} onSubmit={submit} className="flex flex-col gap-5">
              <Section title="The grant">
                <Field label="Name" wide>
                  <input name="name" defaultValue={current.name} className="input" />
                </Field>
                <Field label="Summary" wide>
                  <textarea name="summary" rows={2} defaultValue={current.summary ?? ''} className="input" />
                </Field>
                <Field label="Description" wide>
                  <textarea name="description" rows={4} defaultValue={current.description ?? ''} className="input" />
                </Field>
                <Field label="Programmes (frc, ftc, fll, any)">
                  <input name="programs" defaultValue={current.programs.join(', ')} className="input" />
                </Field>
                <Field label="Effort to apply">
                  <select name="effortLevel" defaultValue={current.effortLevel} className="input">
                    <option value="unknown">Not sure</option>
                    <option value="low">Light: a form, under an hour</option>
                    <option value="medium">Moderate: a short proposal</option>
                    <option value="high">Heavy: a full proposal with budget</option>
                  </select>
                </Field>
              </Section>

              <Section title="Links">
                <Field label="Info page (the funder's page about the grant)" wide>
                  <input name="infoUrl" type="url" defaultValue={current.infoUrl} className="input" />
                </Field>
                <Field label="Application link (the form itself)" wide>
                  <input name="applicationUrl" type="url" defaultValue={current.applicationUrl ?? ''} className="input" placeholder="https://" />
                </Field>
                <Field label="How to apply">
                  <select name="applyMethod" defaultValue="unknown" className="input">
                    <option value="unknown">Not sure</option>
                    <option value="online_form">Online form or portal</option>
                    <option value="email">By email</option>
                    <option value="letter">By post</option>
                    <option value="contact">Contact them first</option>
                  </select>
                </Field>
                <Field label="Contact email">
                  <input name="contactEmail" type="email" className="input" placeholder="grants@funder.org" />
                </Field>
              </Section>

              <Section title="Money">
                <Field label={`Minimum award (${current.awardCurrency})`}>
                  <input name="awardMin" type="number" min="1" defaultValue={current.awardMin ?? ''} className="input" />
                </Field>
                <Field label={`Maximum award (${current.awardCurrency})`}>
                  <input name="awardMax" type="number" min="1" defaultValue={current.awardMax ?? ''} className="input" />
                </Field>
                <Field label="Award notes (the funder's wording)" wide>
                  <input name="awardNotes" defaultValue={current.awardNotes ?? ''} className="input" />
                </Field>
                <Field label="Can a team apply again in a later round?">
                  <select name="renewable" defaultValue={current.renewable === null ? '' : current.renewable ? 'yes' : 'no'} className="input">
                    <option value="">Not sure</option>
                    <option value="yes">Yes</option>
                    <option value="no">No, one award per team</option>
                  </select>
                </Field>
                <Field label="Currency (3 letters)">
                  <input name="awardCurrency" defaultValue={current.awardCurrency} maxLength={3} className="input" />
                </Field>
              </Section>

              <Section title="Dates">
                <Field label="Deadline type">
                  <select name="deadlineType" defaultValue={current.deadlineType} className="input">
                    <option value="unknown">Not sure</option>
                    <option value="fixed">One fixed deadline</option>
                    <option value="annual_window">Opens and closes each year</option>
                    <option value="rolling">Rolling, no deadline</option>
                  </select>
                </Field>
                <Field label="Next deadline">
                  <input name="deadlineAt" type="date" defaultValue={current.nextDeadline ?? ''} className="input" />
                </Field>
                <Field label="Opens">
                  <input name="opensAt" type="date" defaultValue={current.nextOpens ?? ''} className="input" />
                </Field>
                <Field label="Decisions announced">
                  <input name="decisionAt" type="date" className="input" />
                </Field>
                <Field label="The funder's wording on timing" wide>
                  <input name="deadlineNote" className="input" placeholder="e.g. Applications close at 5pm ET" />
                </Field>
              </Section>

              <Section title="Who and where">
                <Field label="Who is eligible (in the funder's words)" wide>
                  <textarea name="eligibilityText" rows={2} className="input" />
                </Field>
                <Field label="Scope">
                  <select name="geoScope" defaultValue={current.geoScope} className="input">
                    <option value="international">International</option>
                    <option value="national">National</option>
                    <option value="state">One or more states</option>
                    <option value="region">A region</option>
                    <option value="local">Local</option>
                  </select>
                </Field>
                <Field label="Countries (codes, e.g. US, CA)">
                  <input name="countries" defaultValue={current.countries.join(', ')} className="input" />
                </Field>
                <Field label="States or provinces (codes, e.g. MI, ON)">
                  <input name="regions" defaultValue={current.regions.join(', ')} className="input" />
                </Field>
                <Field label="Where exactly (the funder's wording)">
                  <input name="localityNote" defaultValue={current.localityNote ?? ''} className="input" />
                </Field>
              </Section>

              <Section title={admin ? 'Notes' : 'Your evidence'}>
                <Field label="Anything else" wide>
                  <textarea name="note" rows={2} className="input" placeholder="What you know that the page does not say" />
                </Field>
                <Field label={admin ? 'Where you saw this (optional)' : 'Where did you see this? (required)'} wide>
                  <input name="evidenceUrl" type="url" required={!admin} className="input" placeholder="https://funder.org/grants/..." />
                </Field>
                {!admin && (
                  <Field label="Your email (optional, in case a reviewer has a question)" wide>
                    <input name="email" type="email" className="input" />
                  </Field>
                )}
              </Section>

              {error && <p className="text-sm text-reg-closed">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>{busy ? (admin ? 'Saving…' : 'Sending…') : admin ? 'Save edit' : 'Send for review'}</Button>
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary">Cancel</Button>
                </Dialog.Close>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? 'flex flex-col gap-1 sm:col-span-2' : 'flex flex-col gap-1'}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

/** A small nudge next to a fact the listing does not have yet; opens the dialog on that field. */
export function KnowThisLink({ what, field }: { what: string; field: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { field } }))}
      className="ml-2 text-xs text-primary hover:underline"
    >
      Know the {what}? Tell us
    </button>
  )
}
