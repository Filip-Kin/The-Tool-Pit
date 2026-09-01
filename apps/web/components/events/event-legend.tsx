/**
 * Legend for the event pin colours. The map is keyed on TIME, so the legend
 * is too: what is happening in the next month, what is further out, what has
 * already run, and what was cancelled.
 */
export function EventLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      <LegendItem color="#7c3aed" size={16} label="Within a month" />
      <LegendItem color="#a78bfa" size={13} label="Later this season" />
      <LegendItem color="#6b7280" size={11} label="Already run" />
      <LegendItem color="#ef4444" size={12} label="Cancelled" />
    </div>
  )
}

function LegendItem({ color, size, label }: { color: string; size: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block rounded-full border border-white/50"
        style={{ width: size, height: size, background: color }}
      />
      {label}
    </span>
  )
}
