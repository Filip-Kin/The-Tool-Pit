'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import {
  PROFILE_GROUPS,
  computeCompleteness,
  isProfileFieldFilled,
  profileFieldSpec,
  type ProfileFieldKey,
  type ProfileFieldValues,
  type ProfileGroupKey,
} from './profile-fields'
import {
  BOILERPLATE_KEYS,
  ORG_TYPE_HINT,
  ORG_TYPE_LABEL,
  ORG_TYPE_OPTIONS,
  SCHOOL_TYPE_LABEL,
  SCHOOL_TYPE_OPTIONS,
  customBoilerplateKeys,
} from './profile-labels'

/**
 * The team profile editor.
 *
 * One long form rather than a wizard. A wizard would be tidier to look at and
 * worse to use: this is filled in over weeks by several people, mostly to
 * change one box, and hiding the other twenty behind Next buttons makes that a
 * chore.
 *
 * Two things are deliberate and easy to get wrong later:
 *
 *  1. Every field is rendered even when it does not apply to this team's
 *     organisation type. A hidden input is absent from the FormData, and the
 *     server action reads absent as empty, so hiding the EIN box the moment
 *     someone switches to 'school_club' would silently delete an EIN they had
 *     already entered. Fields that do not apply are marked, not removed, and
 *     the completeness maths skips them.
 *  2. Inputs are controlled AND named. Controlled so the completeness figure
 *     moves as you type, named so the submit path is a plain
 *     `new FormData(form)` with no hand-written serialisation to drift from
 *     what the action expects.
 */

// #region state

interface FormState {
  teamName: string
  orgType: string
  ein: string
  fiscalSponsorName: string
  schoolType: string
  schoolName: string
  /** '' means nobody has said, which is not the same as 'no'. */
  titleOne: '' | 'yes' | 'no'
  country: string
  region: string
  city: string
  postalCode: string
  mailingAddress: string
  rookieYear: string
  studentCount: string
  mentorCount: string
  annualBudget: string
  contactName: string
  contactEmail: string
  contactPhone: string
  website: string
  missionStatement: string
  boilerplate: Record<string, string>
}

/** The profile columns this form reads. The page selects the whole row and passes it in. */
export interface TeamProfileFormValues {
  id: string
  program: string
  teamNumber: number
  teamName: string | null
  orgType: string
  ein: string | null
  fiscalSponsorName: string | null
  schoolType: string
  schoolName: string | null
  titleOne: boolean | null
  country: string
  region: string | null
  city: string | null
  postalCode: string | null
  mailingAddress: string | null
  rookieYear: number | null
  studentCount: number | null
  mentorCount: number | null
  annualBudget: number | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  website: string | null
  missionStatement: string | null
  boilerplate: Record<string, string> | null
  completeness: number
}

function toState(profile: TeamProfileFormValues): FormState {
  const num = (n: number | null) => (n == null ? '' : String(n))
  return {
    teamName: profile.teamName ?? '',
    orgType: profile.orgType,
    ein: profile.ein ?? '',
    fiscalSponsorName: profile.fiscalSponsorName ?? '',
    schoolType: profile.schoolType,
    schoolName: profile.schoolName ?? '',
    titleOne: profile.titleOne === null ? '' : profile.titleOne ? 'yes' : 'no',
    country: profile.country ?? '',
    region: profile.region ?? '',
    city: profile.city ?? '',
    postalCode: profile.postalCode ?? '',
    mailingAddress: profile.mailingAddress ?? '',
    rookieYear: num(profile.rookieYear),
    studentCount: num(profile.studentCount),
    mentorCount: num(profile.mentorCount),
    annualBudget: num(profile.annualBudget),
    contactName: profile.contactName ?? '',
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    website: profile.website ?? '',
    missionStatement: profile.missionStatement ?? '',
    boilerplate: { ...(profile.boilerplate ?? {}) },
  }
}

/**
 * The shape the completeness maths wants. Mirrors the server action's parsing
 * so the live figure and the stored one agree: an empty box is null, and a
 * number that has not been typed yet is null rather than NaN.
 */
function toFieldValues(state: FormState): ProfileFieldValues {
  const text = (v: string) => (v.trim() === '' ? null : v.trim())
  const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null)
  return {
    teamName: text(state.teamName),
    orgType: state.orgType,
    ein: text(state.ein),
    fiscalSponsorName: text(state.fiscalSponsorName),
    schoolType: state.schoolType,
    schoolName: text(state.schoolName),
    titleOne: state.titleOne === '' ? null : state.titleOne === 'yes',
    country: text(state.country) ?? 'US',
    region: text(state.region),
    city: text(state.city),
    postalCode: text(state.postalCode),
    mailingAddress: text(state.mailingAddress),
    rookieYear: int(state.rookieYear),
    studentCount: int(state.studentCount),
    mentorCount: int(state.mentorCount),
    annualBudget: int(state.annualBudget),
    contactName: text(state.contactName),
    contactEmail: text(state.contactEmail),
    contactPhone: text(state.contactPhone),
    website: text(state.website),
    missionStatement: text(state.missionStatement),
    boilerplate: Object.fromEntries(
      Object.entries(state.boilerplate).filter(([, v]) => v.trim() !== ''),
    ),
  }
}

// #endregion

export function TeamProfileForm({
  profile,
  canEdit,
  /** field name to the number of grants currently stuck on it, from the matcher. */
  costByField,
  saveAction,
}: {
  profile: TeamProfileFormValues
  canEdit: boolean
  costByField: Record<string, number>
  saveAction: (formData: FormData) => Promise<{ error?: string; completeness?: number }>
}) {
  const router = useRouter()
  const [state, setState] = useState<FormState>(() => toState(profile))
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const values = useMemo(() => toFieldValues(state), [state])
  const completeness = useMemo(() => computeCompleteness(values), [values])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false)
    setState((prev) => ({ ...prev, [key]: value }))
  }

  function setBoilerplate(key: string, value: string) {
    setSaved(false)
    setState((prev) => ({ ...prev, boilerplate: { ...prev.boilerplate, [key]: value } }))
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    setError(null)
    start(async () => {
      const res = await saveAction(data)
      if (res.error) {
        setError(res.error)
        return
      }
      setSaved(true)
      // Refresh so the "what this is costing you" panel above the form reflects
      // the save. The match counts themselves only change once the worker has
      // rerun, which the panel says for itself.
      router.refresh()
    })
  }

  /** Shared props for every field wrapper, so the cost chips stay consistent. */
  const fieldProps = (key: ProfileFieldKey) => ({
    fieldKey: key,
    values,
    grantCount: costByField[key] ?? 0,
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="profileId" value={profile.id} />

      <CompletenessBar percent={completeness} stored={profile.completeness} />

      {!canEdit && (
        <p role="status" className="rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
          You have view access to this profile. Ask an owner for edit access to change anything.
        </p>
      )}

      <fieldset disabled={!canEdit || pending} className="flex flex-col gap-8">
        <Group groupKey="entity">
          <Field {...fieldProps('teamName')} label="Team name">
            <input
              name="teamName"
              value={state.teamName}
              onChange={(e) => set('teamName', e.target.value)}
              placeholder={`Team ${profile.teamNumber}`}
              className="input"
            />
          </Field>

          <Field {...fieldProps('orgType')} label="Organisation type">
            <select
              name="orgType"
              value={state.orgType}
              onChange={(e) => set('orgType', e.target.value)}
              className="input"
            >
              {ORG_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {ORG_TYPE_LABEL[o]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-2">
              {ORG_TYPE_HINT[state.orgType as keyof typeof ORG_TYPE_HINT] ?? ''}
            </p>
          </Field>

          <Field {...fieldProps('ein')} label="EIN">
            <input
              name="ein"
              value={state.ein}
              onChange={(e) => set('ein', e.target.value)}
              placeholder="12-3456789"
              inputMode="numeric"
              className="input"
            />
          </Field>

          <Field {...fieldProps('fiscalSponsorName')} label="Fiscal sponsor">
            <input
              name="fiscalSponsorName"
              value={state.fiscalSponsorName}
              onChange={(e) => set('fiscalSponsorName', e.target.value)}
              placeholder="The 501(c)(3) that receives the money for you"
              className="input"
            />
          </Field>

          <Field {...fieldProps('schoolType')} label="School type">
            <select
              name="schoolType"
              value={state.schoolType}
              onChange={(e) => set('schoolType', e.target.value)}
              className="input"
            >
              {SCHOOL_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {SCHOOL_TYPE_LABEL[o]}
                </option>
              ))}
            </select>
          </Field>

          <Field {...fieldProps('schoolName')} label="School name">
            <input
              name="schoolName"
              value={state.schoolName}
              onChange={(e) => set('schoolName', e.target.value)}
              className="input"
            />
          </Field>

          <Field {...fieldProps('titleOne')} label="Title I school">
            <select
              name="titleOne"
              value={state.titleOne}
              onChange={(e) => set('titleOne', e.target.value as FormState['titleOne'])}
              className="input"
            >
              {/* The empty option is first and is a real answer of "we have not
                  checked". Defaulting it to No would rule the team out of
                  equity-focused funding they may well qualify for. */}
              <option value="">Not sure</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </Group>

        <Group groupKey="place">
          <Field {...fieldProps('country')} label="Country">
            <input
              name="country"
              value={state.country}
              onChange={(e) => set('country', e.target.value)}
              placeholder="US"
              className="input"
            />
            <p className="mt-1 text-xs text-muted-2">Two-letter code, for example US, CA, MX, IL, TR.</p>
          </Field>

          <Field {...fieldProps('region')} label="State or province">
            <input
              name="region"
              value={state.region}
              onChange={(e) => set('region', e.target.value)}
              placeholder="MI"
              className="input"
            />
          </Field>

          <Field {...fieldProps('city')} label="City">
            <input name="city" value={state.city} onChange={(e) => set('city', e.target.value)} className="input" />
          </Field>

          <Field {...fieldProps('postalCode')} label="Postal code">
            <input
              name="postalCode"
              value={state.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
              className="input"
            />
          </Field>

          <Field {...fieldProps('mailingAddress')} label="Mailing address" wide>
            <textarea
              name="mailingAddress"
              value={state.mailingAddress}
              onChange={(e) => set('mailingAddress', e.target.value)}
              rows={3}
              className="input"
            />
          </Field>
        </Group>

        <Group groupKey="size">
          <Field {...fieldProps('rookieYear')} label="Rookie year">
            <input
              name="rookieYear"
              value={state.rookieYear}
              onChange={(e) => set('rookieYear', e.target.value)}
              inputMode="numeric"
              placeholder="2011"
              className="input"
            />
          </Field>

          <Field {...fieldProps('studentCount')} label="Students on the team">
            <input
              name="studentCount"
              value={state.studentCount}
              onChange={(e) => set('studentCount', e.target.value)}
              inputMode="numeric"
              className="input"
            />
          </Field>

          <Field {...fieldProps('mentorCount')} label="Mentors">
            <input
              name="mentorCount"
              value={state.mentorCount}
              onChange={(e) => set('mentorCount', e.target.value)}
              inputMode="numeric"
              className="input"
            />
          </Field>

          <Field {...fieldProps('annualBudget')} label="Annual budget">
            <input
              name="annualBudget"
              value={state.annualBudget}
              onChange={(e) => set('annualBudget', e.target.value)}
              inputMode="numeric"
              placeholder="25000"
              className="input"
            />
          </Field>
        </Group>

        <Group groupKey="contact">
          <Field {...fieldProps('contactName')} label="Contact name">
            <input
              name="contactName"
              value={state.contactName}
              onChange={(e) => set('contactName', e.target.value)}
              className="input"
            />
          </Field>

          <Field {...fieldProps('contactEmail')} label="Contact email">
            <input
              name="contactEmail"
              type="email"
              value={state.contactEmail}
              onChange={(e) => set('contactEmail', e.target.value)}
              className="input"
            />
          </Field>

          <Field {...fieldProps('contactPhone')} label="Contact phone">
            <input
              name="contactPhone"
              value={state.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value)}
              className="input"
            />
          </Field>

          <Field {...fieldProps('website')} label="Team website">
            <input
              name="website"
              value={state.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://"
              className="input"
            />
          </Field>
        </Group>

        <Group groupKey="prose">
          <Field {...fieldProps('missionStatement')} label="Mission statement" wide>
            <textarea
              name="missionStatement"
              value={state.missionStatement}
              onChange={(e) => set('missionStatement', e.target.value)}
              rows={4}
              placeholder="One or two sentences on what the team is for."
              className="input"
            />
          </Field>

          <div className="sm:col-span-2 flex flex-col gap-5">
            {BOILERPLATE_KEYS.map((b) => (
              <label key={b.key} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">{b.label}</span>
                <span className="text-xs text-muted-2">{b.prompt}</span>
                <textarea
                  name={`boilerplate.${b.key}`}
                  value={state.boilerplate[b.key] ?? ''}
                  onChange={(e) => setBoilerplate(b.key, e.target.value)}
                  rows={4}
                  className="input"
                />
              </label>
            ))}

            {/* Answers under keys we never suggested, usually because an admin
                pointed a form-field map at one. Rendered so a save cannot drop
                them. */}
            {customBoilerplateKeys(profile.boilerplate).map((key) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">{key}</span>
                <span className="text-xs text-muted-2">
                  A custom answer already on your profile. Kept because an application form may point at it.
                </span>
                <textarea
                  name={`boilerplate.${key}`}
                  value={state.boilerplate[key] ?? ''}
                  onChange={(e) => setBoilerplate(key, e.target.value)}
                  rows={3}
                  className="input"
                />
              </label>
            ))}
          </div>
        </Group>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-4 border-t border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save profile'}
          </button>
          {saved && !pending && (
            <span role="status" className="text-sm text-rookie">
              Saved. Your matches will be recalculated shortly.
            </span>
          )}
          {/* role=alert so a screen reader hears a rejected value, since the
              only other signal is the number not changing. */}
          {error && (
            <span role="alert" className="text-sm text-frc">
              {error}
            </span>
          )}
        </div>
      )}
    </form>
  )
}

// #region layout pieces

function Group({ groupKey, children }: { groupKey: ProfileGroupKey; children: React.ReactNode }) {
  const group = PROFILE_GROUPS.find((g) => g.key === groupKey)
  if (!group) return null
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">{group.title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{group.blurb}</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  )
}

/**
 * One labelled field, with the three things that make this form worth filling
 * in: why it matters, whether it is private, and how many grants are waiting on
 * it right now.
 */
function Field({
  fieldKey,
  label,
  values,
  grantCount,
  wide,
  children,
}: {
  fieldKey: ProfileFieldKey
  label: string
  values: ProfileFieldValues
  grantCount: number
  wide?: boolean
  children: React.ReactNode
}) {
  const spec = profileFieldSpec(fieldKey)
  const applies = !spec?.appliesTo || spec.appliesTo(values)
  const filled = isProfileFieldFilled(values, fieldKey)

  return (
    <label className={wide ? 'sm:col-span-2 flex flex-col gap-1.5' : 'flex flex-col gap-1.5'}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {spec?.private && (
          <span className="flex items-center gap-1 text-xs text-muted-2">
            <Lock className="h-3 w-3" />
            Private
          </span>
        )}
        {!filled && grantCount > 0 && (
          <span className="rounded-full border border-official/30 bg-official/15 px-2 py-0.5 text-xs font-medium text-official">
            {grantCount} grant{grantCount === 1 ? '' : 's'} waiting
          </span>
        )}
        {!applies && (
          <span className="text-xs text-muted-2">Not needed for your organisation type</span>
        )}
      </span>
      {children}
      {spec?.why && <span className="text-xs text-muted-2">{spec.why}</span>}
    </label>
  )
}

function CompletenessBar({ percent, stored }: { percent: number; stored: number }) {
  const unsaved = percent !== stored
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">Profile completeness</span>
        <span className="text-lg font-semibold tabular-nums text-foreground">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completeness"
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-2">
        {unsaved
          ? `Not saved yet. Stored value is ${stored}%.`
          : 'Weighted, so the fields grants are actually tested against count for more than a phone number.'}
      </p>
    </div>
  )
}

// #endregion
