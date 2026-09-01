'use client'

import { useState, useTransition } from 'react'
import { MapPin, CalendarDays, Pencil, Check, X, Trash2, RotateCcw, UserRound } from 'lucide-react'
import type { EventListing } from '@the-tool-pit/db'
import {
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
} from '@the-tool-pit/db/event-enums'
import {
  EVENT_STATUS_LABEL,
  REGISTRATION_STATUS_LABEL,
  VOLUNTEER_STATUS_LABEL,
  eventDateRange,
  eventLocation,
  costLabel,
} from '@/lib/events/event-display'
import type { PublicEvent } from '@/lib/events/event-display'
import { PinMap } from '@/components/fields/pin-map'
import { approveEvent, suppressEvent, unsuppressEvent, deleteEvent, updateEvent, type EventEditInput } from './actions'

/** The account behind a submission, when the submitter was signed in. Null is normal. */
export interface SubmitterAccount {
  id: string
  displayName: string | null
  email: string | null
}

/** A published-event-ish view over the raw row, for the shared display helpers. */
function asPublic(l: EventListing): PublicEvent {
  return {
    ...l,
    teamCountUpdatedAt: l.teamCountUpdatedAt ? l.teamCountUpdatedAt.toISOString() : null,
  } as unknown as PublicEvent
}

export function EventAdminRow({ listing, account }: { listing: EventListing; account?: SubmitterAccount | null }) {
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const pub = asPublic(listing)
  const loc = eventLocation(pub)
  const cost = costLabel(pub)
  const hasCoords = listing.latitude != null && listing.longitude != null

  function run(fn: () => Promise<{ error?: string } | void>) {
    setMsg(null)
    startTransition(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) setMsg(res.error)
    })
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{listing.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-2">
            {listing.startDate && (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {eventDateRange(pub)}
              </span>
            )}
            {loc && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {loc}
              </span>
            )}
            <span>{EVENT_STATUS_LABEL[listing.eventStatus as keyof typeof EVENT_STATUS_LABEL]}</span>
            <span>{REGISTRATION_STATUS_LABEL[listing.registrationStatus as keyof typeof REGISTRATION_STATUS_LABEL]}</span>
            {listing.capacity != null && <span>{listing.capacity} slots</span>}
            {cost && <span>{cost}</span>}
            {listing.tbaKey && <span className="text-primary">{listing.tbaKey}</span>}
            <span className={hasCoords ? 'text-rookie' : 'text-official'}>{hasCoords ? 'Pin set' : 'No pin yet'}</span>
          </div>
          {(listing.submitterName || listing.submitterContact) && (
            <div className="mt-1 text-xs text-muted-2">
              Submitted by {listing.submitterName ?? 'anon'}
              {listing.submitterContact ? ` · ${listing.submitterContact}` : ''}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-2">
            <UserRound className="h-3 w-3" />
            {account ? (
              <span>
                Account <span className="text-foreground">{account.displayName ?? account.email ?? account.id}</span>
                {account.displayName && account.email ? ` · ${account.email}` : ''}
              </span>
            ) : (
              <span>No account, anonymous submission</span>
            )}
          </div>
          {listing.rejectionReason && <div className="mt-1 text-xs text-official">Reason: {listing.rejectionReason}</div>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button onClick={() => setEditing((v) => !v)} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2">
            <Pencil className="h-3 w-3" /> Edit
          </button>
          {listing.status !== 'published' && (
            <button onClick={() => run(() => approveEvent(listing.id))} disabled={pending} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50">
              <Check className="h-3 w-3" /> Publish
            </button>
          )}
          {listing.status === 'suppressed' ? (
            <button onClick={() => run(() => unsuppressEvent(listing.id))} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2">
              <RotateCcw className="h-3 w-3" /> Restore
            </button>
          ) : (
            <button onClick={() => run(() => suppressEvent(listing.id))} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2">
              <X className="h-3 w-3" /> Suppress
            </button>
          )}
          <button
            onClick={() => {
              if (confirm('Delete this event permanently?')) run(() => deleteEvent(listing.id))
            }}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-frc hover:bg-surface-2"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {msg && <p className="mt-2 text-xs text-official">{msg}</p>}

      {editing && <Editor listing={listing} onDone={() => setEditing(false)} onError={setMsg} />}
    </div>
  )
}

function Editor({ listing, onDone, onError }: { listing: EventListing; onDone: () => void; onError: (m: string) => void }) {
  const [pending, startTransition] = useTransition()
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    listing.latitude != null && listing.longitude != null ? { lat: listing.latitude, lng: listing.longitude } : null,
  )
  const [form, setForm] = useState<EventEditInput>({
    name: listing.name,
    program: listing.program,
    hostTeamNumber: listing.hostTeamNumber,
    venueName: listing.venueName,
    address: listing.address,
    city: listing.city,
    region: listing.region,
    country: listing.country,
    startDate: listing.startDate,
    endDate: listing.endDate,
    days: listing.days,
    parallelDivisions: listing.parallelDivisions,
    capacity: listing.capacity,
    costUsd: listing.costUsd,
    costNote: listing.costNote,
    registrationStatus: listing.registrationStatus,
    registrationOpensAt: listing.registrationOpensAt,
    volunteerStatus: listing.volunteerStatus,
    eventStatus: listing.eventStatus,
    website: listing.website,
    registrationUrl: listing.registrationUrl,
    chiefDelphiUrl: listing.chiefDelphiUrl,
    contactEmail: listing.contactEmail,
    notes: listing.notes,
    tbaKey: listing.tbaKey,
  })

  function set<K extends keyof EventEditInput>(k: K, v: EventEditInput[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function save() {
    startTransition(async () => {
      const res = await updateEvent(listing.id, { ...form, latitude: coords?.lat ?? null, longitude: coords?.lng ?? null })
      if (res.error) onError(res.error)
      else onDone()
    })
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <PinMap value={coords} onChange={setCoords} height={260} />

      <div className="grid gap-3 sm:grid-cols-2">
        <L label="Name"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></L>
        <div className="flex gap-2">
          <L label="Program"><select className="input uppercase" value={form.program} onChange={(e) => set('program', e.target.value)}>{['frc', 'ftc', 'fll'].map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select></L>
          <L label="Host team #"><input type="number" className="input" value={form.hostTeamNumber ?? ''} onChange={(e) => set('hostTeamNumber', e.target.value ? Number(e.target.value) : null)} /></L>
        </div>
        <L label="Start date"><input type="date" className="input" value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} /></L>
        <L label="End date"><input type="date" className="input" value={form.endDate ?? ''} onChange={(e) => set('endDate', e.target.value)} /></L>
        <div className="flex gap-2">
          <L label="Days"><select className="input" value={form.days ?? ''} onChange={(e) => set('days', e.target.value ? Number(e.target.value) : null)}><option value="">—</option><option value="1">1</option><option value="2">2</option></select></L>
          <L label="Capacity"><input type="number" className="input" value={form.capacity ?? ''} onChange={(e) => set('capacity', e.target.value ? Number(e.target.value) : null)} /></L>
        </div>
        <div className="flex gap-2">
          <L label="Cost (USD)"><input type="number" className="input" value={form.costUsd ?? ''} onChange={(e) => set('costUsd', e.target.value ? Number(e.target.value) : null)} /></L>
          <L label="Cost note"><input className="input" value={form.costNote ?? ''} onChange={(e) => set('costNote', e.target.value)} /></L>
        </div>
        <L label="Event status"><select className="input" value={form.eventStatus} onChange={(e) => set('eventStatus', e.target.value)}>{EVENT_STATUSES.map((s) => <option key={s} value={s}>{EVENT_STATUS_LABEL[s]}</option>)}</select></L>
        <L label="Registration"><select className="input" value={form.registrationStatus} onChange={(e) => set('registrationStatus', e.target.value)}>{REGISTRATION_STATUSES.map((s) => <option key={s} value={s}>{REGISTRATION_STATUS_LABEL[s]}</option>)}</select></L>
        <L label="Registration opens"><input type="date" className="input" value={form.registrationOpensAt ?? ''} onChange={(e) => set('registrationOpensAt', e.target.value)} /></L>
        <L label="Volunteers"><select className="input" value={form.volunteerStatus} onChange={(e) => set('volunteerStatus', e.target.value)}>{VOLUNTEER_STATUSES.map((s) => <option key={s} value={s}>{VOLUNTEER_STATUS_LABEL[s]}</option>)}</select></L>
        <L label="Venue"><input className="input" value={form.venueName ?? ''} onChange={(e) => set('venueName', e.target.value)} /></L>
        <L label="Address"><input className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></L>
        <L label="City"><input className="input" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></L>
        <L label="Region"><input className="input" value={form.region ?? ''} onChange={(e) => set('region', e.target.value)} /></L>
        <L label="Country"><input className="input" value={form.country ?? ''} onChange={(e) => set('country', e.target.value)} /></L>
        <L label="Website"><input className="input" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} /></L>
        <L label="Registration URL"><input className="input" value={form.registrationUrl ?? ''} onChange={(e) => set('registrationUrl', e.target.value)} /></L>
        <L label="Chief Delphi URL"><input className="input" value={form.chiefDelphiUrl ?? ''} onChange={(e) => set('chiefDelphiUrl', e.target.value)} /></L>
        <L label="Organiser email"><input className="input" value={form.contactEmail ?? ''} onChange={(e) => set('contactEmail', e.target.value)} /></L>
        <L label="TBA key" ><input className="input" value={form.tbaKey ?? ''} onChange={(e) => set('tbaKey', e.target.value)} placeholder="e.g. 2026mifli1" /></L>
      </div>

      <L label="Notes"><textarea rows={2} className="input resize-y" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></L>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={!!form.parallelDivisions} onChange={(e) => set('parallelDivisions', e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
        Two parallel 1-day events (the sheet&apos;s &quot;2x&quot; format)
      </label>

      <div className="flex gap-2">
        <button onClick={save} disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onDone} disabled={pending} className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2">
          Cancel
        </button>
      </div>
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs text-muted-2">{label}</span>
      {children}
    </label>
  )
}
