import {
  GRANT_APPLY_METHODS,
  GRANT_CYCLE_STATUSES,
  GRANT_DEADLINE_TYPES,
  GRANT_EFFORT_LEVELS,
  GRANT_GEO_SCOPES,
  GRANT_PROGRAMS,
  GRANT_STATUSES,
} from '@the-tool-pit/db/grant-enums'

/**
 * The grant fields, rendered once and reused by both editors: the one a
 * candidate opens into before it is published, and the one that edits a live
 * listing. Same markup means the same field names, which means
 * parseGrantFields() in lib/admin/grants.ts validates both the same way.
 *
 * Plain inputs inside the caller's <form>, no client state: everything here is
 * submitted by a server action.
 */

export interface GrantFieldDefaults {
  name?: string | null
  funderName?: string | null
  summary?: string | null
  description?: string | null
  infoUrl?: string | null
  applicationUrl?: string | null
  applyMethod?: string | null
  contactEmail?: string | null
  mailingAddress?: string | null
  programs?: string[] | null
  geoScope?: string | null
  countries?: string[] | null
  regions?: string[] | null
  localityNote?: string | null
  awardMin?: number | null
  awardMax?: number | null
  awardCurrency?: string | null
  awardNotes?: string | null
  renewable?: boolean | null
  deadlineType?: string | null
  effortLevel?: string | null
  status?: string | null
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-muted-2">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary'

export function GrantFields({ defaults = {} }: { defaults?: GrantFieldDefaults }) {
  const d = defaults
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <input name="name" defaultValue={d.name ?? ''} required className={inputClass} />
        </Field>
        <Field label="Funder" hint="Matched on a slug of this name; a new funder is created if there is no match.">
          <input name="funderName" defaultValue={d.funderName ?? ''} className={inputClass} />
        </Field>
      </div>

      <Field label="Summary" hint="One or two sentences. This is the whole card on the public list.">
        <input name="summary" defaultValue={d.summary ?? ''} maxLength={300} className={inputClass} />
      </Field>

      <Field label="Description" hint="Markdown, shown on the detail page.">
        <textarea name="description" defaultValue={d.description ?? ''} rows={6} className={inputClass} />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Info URL" hint="The page a human should read.">
          <input name="infoUrl" defaultValue={d.infoUrl ?? ''} required className={inputClass} />
        </Field>
        <Field label="Application URL" hint="Only if applying happens somewhere other than the info page.">
          <input name="applicationUrl" defaultValue={d.applicationUrl ?? ''} className={inputClass} />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="How to apply" hint="Plenty of real sponsors want a posted letter and have no form at all.">
          <select name="applyMethod" defaultValue={d.applyMethod ?? 'unknown'} className={inputClass}>
            {GRANT_APPLY_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contact email" hint="For applications or questions, if the page gives one.">
          <input name="contactEmail" defaultValue={d.contactEmail ?? ''} className={inputClass} />
        </Field>
        <Field label="Mailing address" hint="Where a posted application goes.">
          <input name="mailingAddress" defaultValue={d.mailingAddress ?? ''} className={inputClass} />
        </Field>
      </div>

      <Field label="Programs" hint="Tick every programme this grant will fund. 'any' means any STEM or youth programme.">
        <div className="flex flex-wrap gap-3 pt-1">
          {GRANT_PROGRAMS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                name="programs"
                value={p}
                defaultChecked={(d.programs ?? ['any']).includes(p)}
                className="accent-primary"
              />
              {p}
            </label>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Geographic scope">
          <select name="geoScope" defaultValue={d.geoScope ?? 'national'} className={inputClass}>
            {GRANT_GEO_SCOPES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Countries" hint="ISO codes, comma separated, e.g. US, CA">
          <input name="countries" defaultValue={(d.countries ?? ['US']).join(', ')} className={inputClass} />
        </Field>
        <Field label="Regions" hint="State or province codes. Required for anything narrower than national.">
          <input name="regions" defaultValue={(d.regions ?? []).join(', ')} className={inputClass} />
        </Field>
      </div>

      <Field label="Locality note" hint="For a county or metro area that has no code of its own.">
        <input name="localityNote" defaultValue={d.localityNote ?? ''} className={inputClass} />
      </Field>

      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Award minimum">
          <input name="awardMin" defaultValue={d.awardMin ?? ''} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Award maximum">
          <input name="awardMax" defaultValue={d.awardMax ?? ''} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Currency">
          <input name="awardCurrency" defaultValue={d.awardCurrency ?? 'USD'} className={inputClass} />
        </Field>
        <Field label="Renewable">
          <select
            name="renewable"
            defaultValue={d.renewable === true ? 'yes' : d.renewable === false ? 'no' : 'unknown'}
            className={inputClass}
          >
            <option value="unknown">unknown</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </Field>
      </div>

      <Field label="Award notes" hint='e.g. "up to 50% of project cost", "in-kind hardware, not cash".'>
        <input name="awardNotes" defaultValue={d.awardNotes ?? ''} className={inputClass} />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Deadline type" hint="Leave as unknown rather than guessing. A wrong deadline is worse than none.">
          <select name="deadlineType" defaultValue={d.deadlineType ?? 'unknown'} className={inputClass}>
            {GRANT_DEADLINE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Effort level">
          <select name="effortLevel" defaultValue={d.effortLevel ?? 'unknown'} className={inputClass}>
            {GRANT_EFFORT_LEVELS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" hint="Only 'published' is visible to teams.">
          <select name="status" defaultValue={d.status ?? 'pending'} className={inputClass}>
            {GRANT_STATUSES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  )
}

// #region cycle

export interface CycleFieldDefaults {
  cycleYear?: number | null
  opensAt?: string | null
  /** ISO-8601 instant WITH an offset. Never a zoneless datetime-local value. */
  deadlineAt?: string | null
  deadlineNote?: string | null
  decisionAt?: string | null
  status?: string | null
  amountNote?: string | null
  sourceUrl?: string | null
  isEstimated?: boolean | null
}

/**
 * One cycle's dates. Shared by the publish editor (where it is the optional
 * opening cycle) and the grant editor (where it adds or edits any year), so
 * parseCycleFields() in lib/admin/grants.ts sees identical field names.
 *
 * The deadline is a plain text box, not <input type="datetime-local">. A
 * datetime-local hands the server a zoneless string that silently picks up the
 * container's timezone, and "11:59pm ET" versus "11:59pm PT" is the entire
 * point of a deadline. Typing the offset is the smaller cost.
 */
export function CycleFields({ defaults = {} }: { defaults?: CycleFieldDefaults }) {
  const d = defaults
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Cycle year" hint="The calendar year the round CLOSES in.">
          <input name="cycleYear" defaultValue={d.cycleYear ?? ''} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Opens" hint="YYYY-MM-DD. Leave blank if the funder does not say.">
          <input name="opensAt" defaultValue={d.opensAt ?? ''} placeholder="2027-01-15" className={inputClass} />
        </Field>
        <Field label="Decision" hint="YYYY-MM-DD, when decisions are announced.">
          <input name="decisionAt" defaultValue={d.decisionAt ?? ''} placeholder="2027-05-01" className={inputClass} />
        </Field>
      </div>

      <Field
        label="Deadline"
        hint="Full ISO-8601 with the funder's own offset, e.g. 2027-03-01T23:59:00-05:00. Blank beats a guess."
      >
        <input
          name="deadlineAt"
          defaultValue={d.deadlineAt ?? ''}
          placeholder="2027-03-01T23:59:00-05:00"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Deadline note" hint="The funder's own wording, e.g. “11:59pm Eastern”.">
          <input name="deadlineNote" defaultValue={d.deadlineNote ?? ''} className={inputClass} />
        </Field>
        <Field label="Cycle status">
          <select name="cycleStatus" defaultValue={d.status ?? 'unknown'} className={inputClass}>
            {GRANT_CYCLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Cycle amount note" hint="Only when this year differs from the grant's usual award.">
          <input name="amountNote" defaultValue={d.amountNote ?? ''} className={inputClass} />
        </Field>
        <Field label="Cycle source URL" hint="The exact page these dates came off.">
          <input name="cycleSourceUrl" defaultValue={d.sourceUrl ?? ''} className={inputClass} />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-xs text-foreground">
        <input name="isEstimated" type="checkbox" defaultChecked={d.isEstimated ?? false} className="mt-0.5 accent-primary" />
        <span>
          Estimated, carried over from a previous year.
          <span className="block text-[10px] text-muted-2">
            Renders as “expected” and is never used for a deadline reminder.
          </span>
        </span>
      </label>
    </div>
  )
}

// #endregion
