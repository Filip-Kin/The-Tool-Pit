/**
 * Legend for the event pin colours. The map is keyed on registration, so the
 * legend is too. Sizes mirror eventMarkerStyle, scaled down to fit a line of
 * text: if the legend and the map ever disagree, the legend is a lie. Same
 * tokens as the pins, for the same reason.
 */
export function EventLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {/* Not-yet-open leads, because it is the state that comes first in an
          event's life and it reads as a lighter shade of open. */}
      <LegendItem color="var(--color-reg-soon)" size={14} label="Not yet open" />
      <LegendItem color="var(--color-reg-open)" size={16} label="Registration open" />
      <LegendItem color="var(--color-reg-waitlist)" size={13} label="Waitlist" />
      <LegendItem color="var(--color-reg-closed)" size={12} label="Closed" />
      <LegendItem color="var(--color-reg-moot)" size={11} label="Completed, cancelled, or unknown" />
    </div>
  )
}

function LegendItem({ color, size, label }: { color: string; size: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block rounded-full border border-pin-ring"
        style={{ width: size, height: size, background: color }}
      />
      {label}
    </span>
  )
}
