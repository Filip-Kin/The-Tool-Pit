'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { EditableListing } from '@/lib/queries/listing-ownership'

/**
 * The owner edit form for a listing.
 *
 * One component, three field sets, because the three verticals genuinely edit
 * different things. Only the descriptive columns are here: status, ranking and
 * anything an admin controls are deliberately absent, so an owner can improve
 * their own listing without being able to publish or promote it. The action is
 * passed in from the page and re-checks edit access server-side, so this file
 * holds no permission logic.
 */
export function ListingEditForm({
  entityId,
  listing,
  toolTypeOptions,
  saveAction,
}: {
  entityId: string
  listing: EditableListing
  /**
   * The allowed tool types, passed in from the server. Not imported here: the
   * db schema barrel is server-only, so a client component takes the list as a
   * prop rather than pulling the whole schema into the browser bundle.
   */
  toolTypeOptions: readonly string[]
  saveAction: (formData: FormData) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    setMsg(null)
    setErr(null)
    start(async () => {
      const res = await saveAction(data)
      if (res.error) setErr(res.error)
      else {
        setMsg(res.message ?? 'Saved.')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 rounded-lg border border-border-subtle bg-surface p-5">
      <input type="hidden" name="entityId" value={entityId} />

      {listing.entityType === 'tool' && <ToolFields values={listing.values} toolTypeOptions={toolTypeOptions} />}
      {listing.entityType === 'album' && <AlbumFields values={listing.values} />}
      {listing.entityType === 'field' && <FieldFields values={listing.values} />}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
      {err && (
        <p role="alert" className="text-sm text-frc">
          {err}
        </p>
      )}
    </form>
  )
}

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-2">{hint}</span>}
    </label>
  )
}

function humanizeToolType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function ToolFields({
  values,
  toolTypeOptions,
}: {
  values: Extract<EditableListing, { entityType: 'tool' }>['values']
  toolTypeOptions: readonly string[]
}) {
  return (
    <>
      <Field label="Name">
        <input name="name" defaultValue={values.name} required maxLength={200} className="input" />
      </Field>
      <Field label="Type">
        <select name="toolType" defaultValue={values.toolType} className="input">
          {toolTypeOptions.map((t) => (
            <option key={t} value={t}>
              {humanizeToolType(t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Summary" hint="One or two sentences shown on the card.">
        <input name="summary" defaultValue={values.summary ?? ''} maxLength={500} className="input" />
      </Field>
      <Field label="Description" hint="Markdown is fine.">
        <textarea name="description" defaultValue={values.description ?? ''} rows={8} className="input" />
      </Field>
      <Field label="Vendor name" hint="Leave blank unless a company publishes this.">
        <input name="vendorName" defaultValue={values.vendorName ?? ''} maxLength={200} className="input" />
      </Field>
    </>
  )
}

function AlbumFields({ values }: { values: Extract<EditableListing, { entityType: 'album' }>['values'] }) {
  return (
    <>
      <Field label="Title">
        <input name="title" defaultValue={values.title ?? ''} maxLength={300} className="input" />
      </Field>
      <Field label="Photographer">
        <input name="photographer" defaultValue={values.photographer ?? ''} maxLength={200} className="input" />
      </Field>
      <Field label="Date" hint="How the date shows on the album, e.g. Apr 12-14.">
        <input name="dateText" defaultValue={values.dateText ?? ''} maxLength={120} className="input" />
      </Field>
      <Field label="Description">
        <textarea name="description" defaultValue={values.description ?? ''} rows={5} className="input" />
      </Field>
    </>
  )
}

function FieldFields({ values }: { values: Extract<EditableListing, { entityType: 'field' }>['values'] }) {
  return (
    <>
      <Field label="Field name">
        <input name="name" defaultValue={values.name} required maxLength={200} className="input" />
      </Field>
      <Field label="Open hours" hint="Free text, e.g. weekends by arrangement.">
        <input name="hours" defaultValue={values.hours ?? ''} maxLength={500} className="input" />
      </Field>
      <Field label="How to arrange access">
        <textarea name="contactInfo" defaultValue={values.contactInfo ?? ''} rows={3} className="input" />
      </Field>
      <Field label="Booking or contact link">
        <input name="contactUrl" defaultValue={values.contactUrl ?? ''} maxLength={500} className="input" />
      </Field>
      <Field label="Website">
        <input name="website" defaultValue={values.website ?? ''} maxLength={500} className="input" />
      </Field>
      <Field label="Notes">
        <textarea name="notes" defaultValue={values.notes ?? ''} rows={4} className="input" />
      </Field>
      <p className="text-xs text-muted-2">
        The field&apos;s location and equipment spec are changed through the suggest-edit flow so a
        move gets a second look. Everything here you can change directly.
      </p>
    </>
  )
}
