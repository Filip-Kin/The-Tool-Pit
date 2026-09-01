import { MapPin, AlertTriangle, Clock, CalendarClock, Tag, ExternalLink, Handshake, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { FieldGallery } from './field-gallery'
import type { PublicField } from '@/lib/fields/field-display'
import {
  fieldMarkerStyle,
  COVERAGE_LABEL,
  PERIMETER_LABEL,
  ELEMENTS_LABEL,
  AVAILABILITY_LABEL,
  accessLabel,
  isLowCeiling,
} from '@/lib/fields/field-display'

/** Team line shown as a subtitle under the field name. Null if no team info. */
function teamSubtitle(f: PublicField): string | null {
  if (f.teamNumber && f.teamName) return `${f.teamNumber} · ${f.teamName}`
  if (f.teamNumber) return `Team ${f.teamNumber}`
  return f.teamName || null
}

function locationOf(f: PublicField): string {
  return [f.city, f.region, f.country].filter(Boolean).join(', ')
}

/** A small round swatch matching this field's pin. */
function PinDot({ f }: { f: PublicField }) {
  const s = fieldMarkerStyle(f.coverage, f.elements)
  return (
    <span
      className="mt-1 inline-block shrink-0 rounded-full border border-white/60"
      style={{ width: 14, height: 14, background: s.color }}
    />
  )
}

function SpecBadges({ f }: { f: PublicField }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge>{COVERAGE_LABEL[f.coverage]}</Badge>
      <Badge>{ELEMENTS_LABEL[f.elements]}</Badge>
      {f.perimeter !== 'none' && <Badge>{PERIMETER_LABEL[f.perimeter]}</Badge>}
      {f.hasFms && <Badge tone="fms">FMS</Badge>}
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'fms' }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-medium',
        tone === 'fms' ? 'bg-primary/15 text-primary' : 'bg-surface-3 text-muted',
      )}
    >
      {children}
    </span>
  )
}

/** Small uppercase program tag, shown only for non-FRC fields (FRC is the default). */
function ProgramTag({ program }: { program: string }) {
  return (
    <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
      {program}
    </span>
  )
}

/** Compact, selectable list row. */
export function FieldCard({
  field,
  selected,
  onSelect,
  distance,
}: {
  field: PublicField
  selected: boolean
  onSelect: (id: string) => void
  /** Pre-formatted distance from the visitor (e.g. "12 mi"), shown when located. */
  distance?: string | null
}) {
  const loc = locationOf(field)
  return (
    <button
      type="button"
      onClick={() => onSelect(field.id)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-primary bg-surface-2' : 'border-border-subtle bg-surface hover:bg-surface-2',
      )}
    >
      <PinDot f={field} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{field.name}</span>
          {field.program !== 'frc' && <ProgramTag program={field.program} />}
        </div>
        {teamSubtitle(field) && <div className="mt-0.5 truncate text-xs text-muted">{teamSubtitle(field)}</div>}
        {(loc || distance) && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-2">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{loc}</span>
            {distance && (
              <span className="ml-auto shrink-0 pl-2 font-medium text-muted">{distance} away</span>
            )}
          </div>
        )}
        <div className="mt-2">
          <SpecBadges f={field} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          {field.availability !== 'unknown' && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {AVAILABILITY_LABEL[field.availability]}
            </span>
          )}
          <span className="flex items-center gap-1">
            {field.contactUrl ? <Link2 className="h-3 w-3" /> : <Handshake className="h-3 w-3" />}
            {accessLabel(field)}
          </span>
          {isLowCeiling(field.ceilingHeightFt) && (
            <span className="flex items-center gap-1 text-official">
              <AlertTriangle className="h-3 w-3" />
              Low ceiling · {field.ceilingHeightFt} ft
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

/** Full detail view, used in the dialog and on the shareable /fields/[id] page. */
export function FieldDetail({ field, onSuggestEdit }: { field: PublicField; onSuggestEdit?: () => void }) {
  const loc = locationOf(field)
  const mapsHref =
    field.latitude != null && field.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${field.latitude}&mlon=${field.longitude}#map=17/${field.latitude}/${field.longitude}`
      : field.address
        ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(field.address)}`
        : null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">{field.name}</h1>
          {field.program !== 'frc' && <ProgramTag program={field.program} />}
        </div>
        {teamSubtitle(field) && <p className="mt-0.5 text-sm text-muted">{teamSubtitle(field)}</p>}
        {loc && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-2">
            <MapPin className="h-4 w-4" />
            {field.address ? `${field.address}, ${loc}` : loc}
          </p>
        )}
      </div>

      {field.photos.length > 0 && <FieldGallery photos={field.photos} alt={field.name} />}

      <SpecBadges f={field} />

      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {field.availability !== 'unknown' && (
          <Row icon={<CalendarClock className="h-4 w-4" />} label="Availability" value={AVAILABILITY_LABEL[field.availability]} />
        )}
        <Row
          icon={field.contactUrl ? <Link2 className="h-4 w-4" /> : <Handshake className="h-4 w-4" />}
          label="Access"
          value={accessLabel(field)}
        />
        {field.hours && <Row icon={<Clock className="h-4 w-4" />} label="Days / hours" value={field.hours} />}
        {field.perimeter !== 'none' && <Row icon={<Tag className="h-4 w-4" />} label="Perimeter" value={PERIMETER_LABEL[field.perimeter]} />}
      </dl>

      {isLowCeiling(field.ceilingHeightFt) && (
        <div className="flex items-center gap-2 rounded-lg border border-official/40 bg-official/10 p-3 text-sm text-official">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Low ceiling ({field.ceilingHeightFt} ft) - may be too low for shooting games.
        </div>
      )}

      {field.notes && <p className="whitespace-pre-wrap text-sm text-muted">{field.notes}</p>}

      <div className="flex flex-wrap gap-3">
        {field.contactUrl && (
          <a href={field.contactUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
            Sign up / contact <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {field.website && (
          <a href={field.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2">
            Website <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {mapsHref && (
          <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2">
            Open in map <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {field.contactInfo && (
        <div className="rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
          <span className="font-medium text-foreground">How to arrange access: </span>
          {field.contactInfo}
        </div>
      )}

      {onSuggestEdit && (
        <div className="border-t border-border-subtle pt-4 text-sm text-muted-2">
          Something out of date?{' '}
          <button type="button" onClick={onSuggestEdit} className="text-primary hover:underline">
            Suggest an edit
          </button>
          . Changes are reviewed before they go live.
        </div>
      )}
    </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-2">{icon}</span>
      <div>
        <dt className="text-xs text-muted-2">{label}</dt>
        <dd className="text-sm text-foreground">{value}</dd>
      </div>
    </div>
  )
}
