import type { FieldElements } from '@the-tool-pit/db/field-enums'
import { fieldMarkerStyle } from '@/lib/fields/field-display'

/**
 * Legend for the pin colours. Grouped by element type (blue = official,
 * red = wood), with the full and half swatches stacked together per group.
 */
export function FieldLegend() {
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted">
      <LegendGroup label="Official elements" elements="official" />
      <LegendGroup label="Wood elements" elements="wood" />
    </div>
  )
}

function LegendGroup({ label, elements }: { label: string; elements: FieldElements }) {
  const full = fieldMarkerStyle('full', elements)
  const half = fieldMarkerStyle('half', elements)
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 font-medium text-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <Swatch color={full.color} size={14} />
        Full field
      </span>
      <span className="flex items-center gap-1.5">
        <Swatch color={half.color} size={11} />
        Half field
      </span>
    </div>
  )
}

function Swatch({ color, size }: { color: string; size: number }) {
  return (
    <span
      className="inline-block rounded-full border border-pin-ring"
      style={{ width: size, height: size, background: color }}
    />
  )
}
