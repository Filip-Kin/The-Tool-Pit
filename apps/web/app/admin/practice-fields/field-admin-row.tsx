'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Pencil, Check, X, Trash2, RotateCcw } from 'lucide-react'
import type { PracticeField } from '@the-tool-pit/db'
import type { FieldPhotoRef } from '@/lib/fields/field-display'
import {
  COVERAGE_LABEL,
  PERIMETER_LABEL,
  ELEMENTS_LABEL,
  AVAILABILITY_LABEL,
  fieldSpecSummary,
} from '@/lib/fields/field-display'
import type { FieldCoverage, FieldElements } from '@the-tool-pit/db'
// Value tuples from the zero-dependency enum subpath (keeps the DB client out of the client bundle).
import { FIELD_COVERAGE, FIELD_PERIMETER, FIELD_ELEMENTS, FIELD_AVAILABILITY, FIELD_PROGRAMS } from '@the-tool-pit/db/field-enums'
import { PinMap } from '@/components/fields/pin-map'
import { approveField, suppressField, unsuppressField, deleteField, updateField, addFieldPhotos, removeFieldPhoto, type FieldEditInput } from './actions'

export function FieldAdminRow({ field, photos }: { field: PracticeField; photos: FieldPhotoRef[] }) {
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const loc = [field.city, field.region, field.country].filter(Boolean).join(', ')
  const hasCoords = field.latitude != null && field.longitude != null

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
          <div className="font-medium text-foreground">
            {field.teamNumber ? `${field.teamNumber} · ` : ''}
            {field.name}
          </div>
          <div className="mt-0.5 text-xs text-muted">{fieldSpecSummary(field as unknown as { coverage: FieldCoverage; elements: FieldElements; hasFms: boolean })}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-2">
            {loc && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {loc}
              </span>
            )}
            <span>{AVAILABILITY_LABEL[field.availability as keyof typeof AVAILABILITY_LABEL]}</span>
            {field.ceilingHeightFt != null && <span>{field.ceilingHeightFt} ft ceiling</span>}
            <span className={hasCoords ? 'text-rookie' : 'text-official'}>
              {hasCoords ? 'Pin set' : 'No pin yet'}
            </span>
          </div>
          {(field.submitterName || field.submitterContact) && (
            <div className="mt-1 text-xs text-muted-2">
              Submitted by {field.submitterName ?? 'anon'}
              {field.submitterContact ? ` · ${field.submitterContact}` : ''}
            </div>
          )}
          {field.rejectionReason && <div className="mt-1 text-xs text-official">Reason: {field.rejectionReason}</div>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button onClick={() => setEditing((v) => !v)} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2">
            <Pencil className="h-3 w-3" /> Edit
          </button>
          {field.status !== 'published' && (
            <button onClick={() => run(() => approveField(field.id))} disabled={pending} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50">
              <Check className="h-3 w-3" /> Publish
            </button>
          )}
          {field.status === 'suppressed' ? (
            <button onClick={() => run(() => unsuppressField(field.id))} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2">
              <RotateCcw className="h-3 w-3" /> Restore
            </button>
          ) : (
            <button onClick={() => run(() => suppressField(field.id))} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2">
              <X className="h-3 w-3" /> Suppress
            </button>
          )}
          <button
            onClick={() => {
              if (confirm('Delete this field permanently?')) run(() => deleteField(field.id))
            }}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-frc hover:bg-surface-2"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {msg && <p className="mt-2 text-xs text-official">{msg}</p>}

      {editing && <Editor field={field} photos={photos} onDone={() => setEditing(false)} onError={setMsg} />}
    </div>
  )
}

function Editor({ field, photos, onDone, onError }: { field: PracticeField; photos: FieldPhotoRef[]; onDone: () => void; onError: (m: string) => void }) {
  const [pending, startTransition] = useTransition()
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    field.latitude != null && field.longitude != null ? { lat: field.latitude, lng: field.longitude } : null,
  )
  const [form, setForm] = useState<FieldEditInput>({
    name: field.name,
    teamNumber: field.teamNumber,
    teamName: field.teamName,
    program: field.program,
    coverage: field.coverage,
    elements: field.elements,
    perimeter: field.perimeter,
    hasFms: field.hasFms,
    ceilingHeightFt: field.ceilingHeightFt,
    availability: field.availability,
    hours: field.hours,
    address: field.address,
    city: field.city,
    region: field.region,
    country: field.country,
    contactInfo: field.contactInfo,
    contactUrl: field.contactUrl,
    website: field.website,
    notes: field.notes,
  })

  function set<K extends keyof FieldEditInput>(k: K, v: FieldEditInput[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function save() {
    startTransition(async () => {
      const res = await updateField(field.id, {
        ...form,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
      })
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
          <L label="Team #"><input type="number" className="input" value={form.teamNumber ?? ''} onChange={(e) => set('teamNumber', e.target.value ? Number(e.target.value) : null)} /></L>
          <L label="Team name"><input className="input" value={form.teamName ?? ''} onChange={(e) => set('teamName', e.target.value)} /></L>
        </div>
        <L label="Program"><select className="input uppercase" value={form.program} onChange={(e) => set('program', e.target.value)}>{FIELD_PROGRAMS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select></L>
        <L label="Coverage"><select className="input" value={form.coverage} onChange={(e) => set('coverage', e.target.value)}>{FIELD_COVERAGE.map((c) => <option key={c} value={c}>{COVERAGE_LABEL[c]}</option>)}</select></L>
        <L label="Elements"><select className="input" value={form.elements} onChange={(e) => set('elements', e.target.value)}>{FIELD_ELEMENTS.map((c) => <option key={c} value={c}>{ELEMENTS_LABEL[c]}</option>)}</select></L>
        <L label="Perimeter"><select className="input" value={form.perimeter} onChange={(e) => set('perimeter', e.target.value)}>{FIELD_PERIMETER.map((c) => <option key={c} value={c}>{PERIMETER_LABEL[c]}</option>)}</select></L>
        <L label="Availability"><select className="input" value={form.availability} onChange={(e) => set('availability', e.target.value)}>{FIELD_AVAILABILITY.map((c) => <option key={c} value={c}>{AVAILABILITY_LABEL[c]}</option>)}</select></L>
        <L label="Ceiling (ft)"><input type="number" step="0.5" className="input" value={form.ceilingHeightFt ?? ''} onChange={(e) => set('ceilingHeightFt', e.target.value ? Number(e.target.value) : null)} /></L>
        <L label="Days / hours"><input className="input" value={form.hours ?? ''} onChange={(e) => set('hours', e.target.value)} /></L>
        <L label="Address"><input className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></L>
        <L label="City"><input className="input" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></L>
        <L label="Region"><input className="input" value={form.region ?? ''} onChange={(e) => set('region', e.target.value)} /></L>
        <L label="Country"><input className="input" value={form.country ?? ''} onChange={(e) => set('country', e.target.value)} /></L>
        <L label="Contact / sign-up URL"><input className="input" value={form.contactUrl ?? ''} onChange={(e) => set('contactUrl', e.target.value)} /></L>
        <L label="Website"><input className="input" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} /></L>
      </div>

      <L label="How to arrange access"><textarea rows={2} className="input resize-y" value={form.contactInfo ?? ''} onChange={(e) => set('contactInfo', e.target.value)} /></L>
      <L label="Notes"><textarea rows={2} className="input resize-y" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></L>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={!!form.hasFms} onChange={(e) => set('hasFms', e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" /> Has FMS</label>
      </div>

      <PhotoManager fieldId={field.id} photos={photos} onError={onError} />

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

/** Immediate photo add/remove for a field (admin changes apply straight away). */
function PhotoManager({ fieldId, photos, onError }: { fieldId: string; photos: FieldPhotoRef[]; onError: (m: string) => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function add(files: FileList | null) {
    if (!files || files.length === 0) return
    const fd = new FormData()
    for (const f of Array.from(files)) fd.append('photos', f)
    startTransition(async () => {
      const res = await addFieldPhotos(fieldId, fd)
      if (res.error) onError(res.error)
      else router.refresh()
      if (inputRef.current) inputRef.current.value = ''
    })
  }

  function remove(photoId: string) {
    startTransition(async () => {
      const res = await removeFieldPhoto(photoId)
      if (res.error) onError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-2">Photos</span>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="h-20 w-24 rounded-md border border-border object-cover" />
              <button
                type="button"
                onClick={() => remove(p.id)}
                disabled={pending}
                aria-label="Remove photo"
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={pending}
        onChange={(e) => add(e.target.files)}
        className="input"
      />
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
