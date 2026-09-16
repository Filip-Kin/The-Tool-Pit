'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { MapPin, CalendarDays, Pencil, Check, X, Trash2, RotateCcw, UserRound, Users, Mail } from 'lucide-react'
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
  effectiveEventStatus,
  effectiveRegistrationStatus,
  eventDateRange,
  eventLocation,
  costLabel,
} from '@/lib/events/event-display'
import type { PublicEvent } from '@/lib/events/event-display'
import { AddressField } from '@/components/fields/address-field'
import { DateField } from '@/components/ui/date-field'
import {
  approveEvent,
  approveRosterSnapshot,
  sendEventOutreach,
  suppressEvent,
  unsuppressEvent,
  deleteEvent,
  updateEvent,
  getTbaCredentialStatus,
  setTbaCredentials,
  clearTbaCredentials,
  type EventEditInput,
} from './actions'
import { ReasonButton } from '@/components/admin/reason-button'
import { teamListStatus } from '@/lib/admin/team-list-status'

/** The account behind a submission, when the submitter was signed in. Null is normal. */
export interface SubmitterAccount {
  id: string
  displayName: string | null
  email: string | null
}

/**
 * One person who OWNS this listing now, which is not the same as who submitted
 * it: a scraped event has an anonymous submitter and can still be claimed and
 * owned later by the team that runs it.
 */
export interface EventOwner {
  role: 'owner' | 'editor'
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

export function EventAdminRow({
  listing,
  account,
  owners = [],
  pendingRoster,
}: {
  listing: EventListing
  account?: SubmitterAccount | null
  /** Who owns this listing now, after any approved claim. Empty when nobody has claimed it. */
  owners?: EventOwner[]
  /** A scraped roster snapshot waiting for a human, when one exists. Its count is not public until approved. */
  pendingRoster?: { snapshotId: string; teamCount: number } | null
}) {
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const pub = asPublic(listing)
  const loc = eventLocation(pub)
  const cost = costLabel(pub)
  const hasCoords = listing.latitude != null && listing.longitude != null

  // The displayed status and registration are DERIVED, the same helpers the
  // public card and map use, so the admin row never shows "Confirmed" for an
  // event that ran last month or "open" for a full or finished one. The stored
  // columns are left as-is: the edit form below still binds to them.
  const now = new Date()
  const statusLabel = EVENT_STATUS_LABEL[effectiveEventStatus(pub, now)]
  const regLabel = REGISTRATION_STATUS_LABEL[effectiveRegistrationStatus(pub, now)]
  const scrape = teamListStatus(listing)

  // The one-time "we listed you" email. Three gates, and the button says which
  // one is holding it back rather than just greying out: no past events ever
  // (today < startDate), a real contact email, and never sent twice.
  const hasContact = !!listing.contactEmail && listing.contactEmail.includes('@')
  const isFuture = !!listing.startDate && listing.startDate > new Date().toISOString().slice(0, 10)
  const outreach = listing.outreachSentAt
    ? { disabled: true, label: `Sent ${listing.outreachSentAt.toLocaleDateString()}`, reason: `Outreach sent to ${listing.outreachSentTo ?? 'the contact'}` }
    : !hasContact
      ? { disabled: true, label: 'Send outreach', reason: 'No contact email to reach' }
      : !isFuture
        ? { disabled: true, label: 'Send outreach', reason: listing.startDate ? 'Event has already run' : 'No start date to confirm it is upcoming' }
        : { disabled: false, label: 'Send outreach', reason: `Email ${listing.contactEmail}` }

  function run(fn: () => Promise<{ error?: string } | void>) {
    setMsg(null)
    startTransition(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) setMsg(res.error)
    })
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
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
            <span>{statusLabel}</span>
            <span>{regLabel}</span>
            {listing.capacity != null && <span>{listing.capacity} slots</span>}
            {cost && <span>{cost}</span>}
            {listing.tbaKey && <span className="text-primary">{listing.tbaKey}</span>}
            <span className={hasCoords ? 'text-rookie' : 'text-official'}>{hasCoords ? 'Pin set' : 'No pin yet'}</span>
            <span
              className={scrape.className}
              title={
                listing.teamListParserUpdatedAt
                  ? `Team-list parser last updated ${listing.teamListParserUpdatedAt.toISOString()}`
                  : undefined
              }
            >
              {scrape.label}
            </span>
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
          {owners.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-2">
              <span className="flex items-center gap-1 text-foreground">
                <UserRound className="h-3 w-3" />
                {owners.length === 1 ? 'Owner' : 'Owners'}
              </span>
              {owners.map((o, i) => (
                <span key={i}>
                  <span className="text-foreground">{o.displayName ?? o.email ?? 'unknown'}</span>
                  {o.displayName && o.email ? ` · ${o.email}` : ''}
                  <span className="text-muted-2"> ({o.role})</span>
                  {i < owners.length - 1 ? ',' : ''}
                </span>
              ))}
            </div>
          )}
          {listing.rejectionReason && <div className="mt-1 text-xs text-official">Reason: {listing.rejectionReason}</div>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-3">
          <Button variant="secondary" size="sm" onClick={() => setEditing((v) => !v)} disabled={pending}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          {/* A scraped roster is waiting. Approving it publishes the count and
              flips the snapshot so the public roster route serves the list. */}
          {pendingRoster && !editing && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => run(() => approveRosterSnapshot(pendingRoster.snapshotId))}
              disabled={pending}
            >
              <Users className="h-3 w-3" /> Approve roster ({pendingRoster.teamCount} teams)
            </Button>
          )}
          {/* Hidden while the editor is open: the editor has its own Save and
              publish, and a Publish up here would ignore everything typed
              below it. */}
          {listing.status !== 'published' && !editing && (
            <Button size="sm" onClick={() => run(() => approveEvent(listing.id))} disabled={pending}>
              <Check className="h-3 w-3" /> Publish
            </Button>
          )}
          {listing.status === 'suppressed' ? (
            <Button variant="secondary" size="sm" onClick={() => run(() => unsuppressEvent(listing.id))} disabled={pending}>
              <RotateCcw className="h-3 w-3" /> Restore
            </Button>
          ) : (
            <ReasonButton
              label={<><X className="h-3 w-3" /> Suppress</>}
              confirmLabel={listing.status === 'published' ? 'Remove' : 'Reject'}
              disabled={pending}
              onConfirm={(reason) => suppressEvent(listing.id, reason)}
            />
          )}
          {!editing && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => run(() => sendEventOutreach(listing.id))}
              disabled={pending || outreach.disabled}
              title={outreach.reason}
            >
              <Mail className="h-3 w-3" /> {outreach.label}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="text-frc"
            onClick={() => {
              if (confirm('Delete this event permanently?')) run(() => deleteEvent(listing.id))
            }}
            disabled={pending}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
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
    registrationClosesAt: listing.registrationClosesAt,
    volunteerStatus: listing.volunteerStatus,
    eventStatus: listing.eventStatus,
    website: listing.website,
    registrationUrl: listing.registrationUrl,
    volunteerUrl: listing.volunteerUrl,
    teamListUrl: listing.teamListUrl,
    chiefDelphiUrl: listing.chiefDelphiUrl,
    contactEmail: listing.contactEmail,
    notes: listing.notes,
    tbaKey: listing.tbaKey,
    tbaKeyDay2: listing.tbaKeyDay2,
    registrationUrlDay2: listing.registrationUrlDay2,
    tbaAutoPush: listing.tbaAutoPush,
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

  /**
   * Save, then publish, in that order and in one press.
   *
   * Publish reads the SAVED row, so with the editor open it could not see the
   * pin that had just been dropped on the map: the answer was "Add a pin
   * location" about a pin visibly sitting on the screen. Two buttons in a fixed
   * order is a sequence to memorise, and the wrong order gives an error that
   * blames the data.
   */
  function saveAndPublish() {
    startTransition(async () => {
      const saved = await updateEvent(listing.id, {
        ...form,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
      })
      if (saved.error) {
        onError(saved.error)
        return
      }
      const published = await approveEvent(listing.id)
      if (published.error) onError(published.error)
      else onDone()
    })
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <L label="Name"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></L>
        <div className="flex gap-2">
          <L label="Program"><select className="input uppercase" value={form.program} onChange={(e) => set('program', e.target.value)}>{['frc', 'ftc', 'fll'].map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select></L>
          <L label="Host team #"><input type="number" className="input" value={form.hostTeamNumber ?? ''} onChange={(e) => set('hostTeamNumber', e.target.value ? Number(e.target.value) : null)} /></L>
        </div>
        <L label="Start date"><DateField value={form.startDate ?? ''} onChange={(v) => set('startDate', v || null)} /></L>
        <L label="End date"><DateField value={form.endDate ?? ''} onChange={(v) => set('endDate', v || null)} /></L>
        <div className="flex gap-2">
          <L label="Days"><select className="input" value={form.days ?? ''} onChange={(e) => set('days', e.target.value ? Number(e.target.value) : null)}><option value="">-</option><option value="1">1</option><option value="2">2</option></select></L>
          <L label="Capacity"><input type="number" className="input" value={form.capacity ?? ''} onChange={(e) => set('capacity', e.target.value ? Number(e.target.value) : null)} /></L>
        </div>
        <div className="flex gap-2">
          <L label="Cost (USD)"><input type="number" className="input" value={form.costUsd ?? ''} onChange={(e) => set('costUsd', e.target.value ? Number(e.target.value) : null)} /></L>
          <L label="Cost note"><input className="input" value={form.costNote ?? ''} onChange={(e) => set('costNote', e.target.value)} /></L>
        </div>
        <L label="Event status"><select className="input" value={form.eventStatus} onChange={(e) => set('eventStatus', e.target.value)}>{EVENT_STATUSES.map((s) => <option key={s} value={s}>{EVENT_STATUS_LABEL[s]}</option>)}</select></L>
        <L label="Registration"><select className="input" value={form.registrationStatus} onChange={(e) => set('registrationStatus', e.target.value)}>{REGISTRATION_STATUSES.map((s) => <option key={s} value={s}>{REGISTRATION_STATUS_LABEL[s]}</option>)}</select></L>
        <L label="Registration opens"><DateField value={form.registrationOpensAt ?? ''} onChange={(v) => set('registrationOpensAt', v || null)} /></L>
        <L label="Registration closes"><DateField value={form.registrationClosesAt ?? ''} onChange={(v) => set('registrationClosesAt', v || null)} /></L>
        <L label="Volunteers"><select className="input" value={form.volunteerStatus} onChange={(e) => set('volunteerStatus', e.target.value)}>{VOLUNTEER_STATUSES.map((s) => <option key={s} value={s}>{VOLUNTEER_STATUS_LABEL[s]}</option>)}</select></L>
        <L label="Venue"><input className="input" value={form.venueName ?? ''} onChange={(e) => set('venueName', e.target.value)} /></L>
        <div className="sm:col-span-2">
          <L label="Address">
            {/* The address field IS the autocomplete: scraped address in place,
                verified suggestions as you edit, ✓ once matched (which fills
                city/region/country and captures the pin). */}
            <AddressField
              defaultQuery={form.address ?? ''}
              verified={coords != null}
              onText={(v) => set('address', v)}
              onPick={(parts, c) => {
                setForm((f) => ({
                  ...f,
                  ...(parts.address ? { address: parts.address } : {}),
                  ...(parts.city ? { city: parts.city } : {}),
                  ...(parts.region ? { region: parts.region } : {}),
                  ...(parts.country ? { country: parts.country } : {}),
                }))
                setCoords(c)
              }}
              onClear={() => setCoords(null)}
            />
          </L>
        </div>
        <L label="City"><input className="input" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></L>
        <L label="Region"><input className="input" value={form.region ?? ''} onChange={(e) => set('region', e.target.value)} /></L>
        <L label="Country"><input className="input" value={form.country ?? ''} onChange={(e) => set('country', e.target.value)} /></L>
        <L label="Website"><input className="input" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} /></L>
        <L label="Registration URL"><input className="input" value={form.registrationUrl ?? ''} onChange={(e) => set('registrationUrl', e.target.value)} /></L>
        <L label="Volunteer URL"><input className="input" value={form.volunteerUrl ?? ''} onChange={(e) => set('volunteerUrl', e.target.value)} /></L>
        <L label="Team list page"><input className="input" value={form.teamListUrl ?? ''} onChange={(e) => set('teamListUrl', e.target.value)} placeholder="the event's own team list" /></L>
        <L label="Chief Delphi URL"><input className="input" value={form.chiefDelphiUrl ?? ''} onChange={(e) => set('chiefDelphiUrl', e.target.value)} /></L>
        <L label="Organiser email"><input className="input" value={form.contactEmail ?? ''} onChange={(e) => set('contactEmail', e.target.value)} /></L>
        <L label={form.parallelDivisions ? 'TBA key, day 1' : 'TBA key'} ><input className="input" value={form.tbaKey ?? ''} onChange={(e) => set('tbaKey', e.target.value)} placeholder="e.g. 2026mifli1" /></L>
        {form.parallelDivisions && (
          <>
            <L label="TBA key, day 2" ><input className="input" value={form.tbaKeyDay2 ?? ''} onChange={(e) => set('tbaKeyDay2', e.target.value)} placeholder="e.g. 2026ketwkz2" /></L>
            <L label="Registration link, day 2" ><input className="input" value={form.registrationUrlDay2 ?? ''} onChange={(e) => set('registrationUrlDay2', e.target.value)} placeholder="Only when day 2 has its own form" /></L>
          </>
        )}
      </div>

      <L label="Notes"><textarea rows={2} className="input resize-y" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></L>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={!!form.parallelDivisions} onChange={(e) => set('parallelDivisions', e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
        Each day is its own 1-day event (the sheet&apos;s &quot;2x&quot; format): own team list, own TBA code, slots per day
      </label>

      <TbaPushSection listing={listing} autoPush={!!form.tbaAutoPush} onAutoPushChange={(v) => set('tbaAutoPush', v)} />

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {listing.status !== 'published' && (
          <Button variant="secondary" onClick={saveAndPublish} disabled={pending}>
            <Check className="h-3 w-3" /> Save and publish
          </Button>
        )}
        <Button variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Push the roster to TBA. auto-push itself is a plain field on the listing
 * (saved with the rest of the form, via Editor's `set`), but the auth_id /
 * auth_secret pair is not: it lives in its own action pair (setTbaCredentials
 * / getTbaCredentialStatus) that never returns the secret to the browser, so
 * this section saves independently of the main "Save changes" button.
 */
function TbaPushSection({
  listing,
  autoPush,
  onAutoPushChange,
}: {
  listing: EventListing
  autoPush: boolean
  onAutoPushChange: (v: boolean) => void
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [authId, setAuthId] = useState('')
  const [authSecret, setAuthSecret] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    getTbaCredentialStatus(listing.id).then((r) => setConfigured(r.configured))
  }, [listing.id])

  function saveCreds() {
    startTransition(async () => {
      const res = await setTbaCredentials(listing.id, authId, authSecret)
      if (res.error) {
        setMsg(res.error)
      } else {
        setAuthId('')
        setAuthSecret('')
        setConfigured(true)
        setMsg('Saved.')
      }
    })
  }

  function clearCreds() {
    startTransition(async () => {
      await clearTbaCredentials(listing.id)
      setConfigured(false)
      onAutoPushChange(false)
      setMsg(null)
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={autoPush}
          disabled={!configured}
          onChange={(e) => onAutoPushChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
        Push the team list to TBA automatically (daily, manual or scraped source, only until the event starts)
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <L label="TBA auth ID">
          <input className="input" value={authId} onChange={(e) => setAuthId(e.target.value)} placeholder={configured ? 'set - enter a new value to replace' : 'from TBA’s request-write-key page'} />
        </L>
        <L label="TBA auth secret">
          <input type="password" className="input" value={authSecret} onChange={(e) => setAuthSecret(e.target.value)} placeholder={configured ? 'set - enter a new value to replace' : ''} />
        </L>
        <Button variant="secondary" onClick={saveCreds} disabled={pending || !authId.trim() || !authSecret.trim()}>
          Save credentials
        </Button>
        {configured && (
          <Button variant="secondary" onClick={clearCreds} disabled={pending}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-2">
        {configured === null
          ? 'Checking…'
          : configured
            ? 'Credentials are set.'
            : 'No credentials set - auto-push stays off until you add them.'}
        {listing.tbaPushedAt && ` Last pushed ${new Date(listing.tbaPushedAt).toLocaleString()} (${listing.tbaPushStatus}).`}
        {listing.tbaPushError && ` ${listing.tbaPushError}`}
      </p>
      {msg && <p className="text-xs text-muted-2">{msg}</p>}
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
