import { MARKER_LEGEND } from '@/lib/fields/field-display'

/** Static legend for the pin colour scheme. */
export function FieldLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      {MARKER_LEGEND.map((row) => (
        <span key={row.label} className="flex items-center gap-1.5">
          <Swatch color={row.style.color} diamond={row.style.shape === 'diamond'} />
          {row.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full bg-transparent ring-2 ring-white" />
        Has FMS
      </span>
    </div>
  )
}

function Swatch({ color, diamond }: { color: string; diamond: boolean }) {
  return (
    <span
      className="inline-block h-3 w-3 border border-black/40"
      style={{ background: color, borderRadius: diamond ? '2px' : '50%', transform: diamond ? 'rotate(45deg)' : undefined }}
    />
  )
}
