'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
 * Three things are deliberate and easy to get wrong later:
 *
 *  1. Every field is rendered even when it does not apply to this team's
 *     organisation type. A hidden input is absent from the FormData, and the
 *     server action reads absent as empty, so hiding the EIN box the moment
 *     someone switches to 'school_club' would silently delete an EIN they had
 *     already entered. Fields that do not apply are marked, not removed, and
 *     the completeness maths skips them.
 *  2. Inputs are controlled AND named. Controlled so the completeness figure
 *     moves as you type, named so the save path is a plain
 *     `new FormData(form)` with no hand-written serialisation to drift from
 *     what the action expects.
 *  3. There is no Save button. It saved fine and behaved badly: a sticky bar at
 *     the bottom of a long form flickers in and out on a phone every time the
 *     keyboard resizes the visual viewport. The status line replacing it is
 *     sticky at the TOP, which the keyboard does not move, and it always
 *     occupies its height so nothing under it shifts.
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

/**
 * A comparable snapshot of the form.
 *
 * Autosave has to be able to answer "has anything actually changed since the
 * server last accepted this?" without keeping a second copy of every field.
 * Boilerplate keys are sorted because setBoilerplate appends a key the first
 * time it is typed into, and insertion order must not read as a change.
 */
function serialiseState(state: FormState): string {
  const boilerplate = Object.keys(state.boilerplate)
    .sort()
    .map((key) => [key, state.boilerplate[key]] as const)
  return JSON.stringify({ ...state, boilerplate })
}

// #endregion

// #region autosave

/** Quiet period after the last keystroke. Long enough to not save mid-word. */
const AUTOSAVE_DEBOUNCE_MS = 800

type SaveStatus =
  /** Loaded and untouched, or edited and waiting for the debounce. */
  | { kind: 'idle'; dirty: boolean }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }

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
  const [state, setState] = useState<FormState>(() => toState(profile))
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle', dirty: false })

  const values = useMemo(() => toFieldValues(state), [state])
  const completeness = useMemo(() => computeCompleteness(values), [values])

  const formRef = useRef<HTMLFormElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Mirrors state, so the debounced callback reads the newest values, not a closed-over old render. */
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  /**
   * The snapshot the server last accepted, seeded with what was loaded so an
   * untouched form never saves. A failed save must NOT update it: that is what
   * stops a rejected value being treated as stored.
   */
  const [loadedSnapshot] = useState(() => serialiseState(toState(profile)))
  const savedRef = useRef(loadedSnapshot)
  const savingRef = useRef(false)
  /** An edit arrived while a save was in flight; run once more when it lands. */
  const queuedRef = useRef(false)

  /**
   * Send the whole form.
   *
   * Whole-form and not per-field, because saveTeamProfile reads an absent
   * FormData key as an empty value: posting one field would blank the other
   * twenty. FormData still comes off the DOM rather than from state, so there
   * is one serialisation and it cannot drift from what the action parses.
   *
   * Validation stays entirely on the server. Duplicating the integer ranges
   * here would give two sets of rules to keep in step, and the action already
   * returns a message we can show. What the user must never get is a value the
   * server rejected sitting in a field that looks saved, so a failure keeps
   * their text, keeps the stale snapshot, and says so.
   */
  const save = useCallback(async () => {
    if (!canEdit) return
    const form = formRef.current
    if (!form) return

    const snapshot = serialiseState(stateRef.current)
    if (snapshot === savedRef.current) return
    if (savingRef.current) {
      queuedRef.current = true
      return
    }

    savingRef.current = true
    setStatus({ kind: 'saving' })
    const res = await saveAction(new FormData(form))
    savingRef.current = false
    const queued = queuedRef.current
    queuedRef.current = false

    if (res.error) {
      // The snapshot stays stale on purpose, so the next blur or keystroke
      // retries rather than believing the rejected value is stored.
      setStatus({ kind: 'failed', message: res.error })
      return
    }
    savedRef.current = snapshot
    setStatus({ kind: 'saved' })

    // Whatever was typed during the round trip has not been sent yet. The
    // snapshot check at the top of the next pass makes this a no-op if it has.
    if (queued) void save()
  }, [canEdit, saveAction])

  /** Cancel the pending debounce and go now. Used by blur, tab-away and Retry. */
  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    void save()
  }, [save])

  function scheduleSave() {
    if (!canEdit) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void save()
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
    setStatus({ kind: 'idle', dirty: true })
    scheduleSave()
  }

  function setBoilerplate(key: string, value: string) {
    setState((prev) => ({ ...prev, boilerplate: { ...prev.boilerplate, [key]: value } }))
    setStatus({ kind: 'idle', dirty: true })
    scheduleSave()
  }

  /**
   * Leaving the field commits it. onBlur on the form catches every input
   * because React's onBlur is focusout, which bubbles, so tabbing between two
   * boxes saves without waiting out the debounce.
   */
  function onBlur() {
    saveNow()
  }

  useEffect(() => {
    /**
     * Switching apps on a phone is how a half-typed answer gets lost: the tab
     * can be discarded while the debounce is still counting. visibilitychange
     * fires before that, beforeunload covers closing the tab on a desktop.
     */
    function onHide() {
      if (document.visibilityState === 'hidden') saveNow()
    }
    function onUnload(e: BeforeUnloadEvent) {
      if (serialiseState(stateRef.current) === savedRef.current) return
      e.preventDefault()
      // Older engines ignore preventDefault here and want a set returnValue.
      e.returnValue = ''
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [saveNow])

  /** Shared props for every field wrapper, so the cost chips stay consistent. */
  const fieldProps = (key: ProfileFieldKey) => ({
    fieldKey: key,
    values,
    grantCount: costByField[key] ?? 0,
  })

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        // Enter in a text box still implicit-submits a form with no submit
        // button. Commit rather than reload the page.
        e.preventDefault()
        saveNow()
      }}
      onBlur={onBlur}
      className="flex flex-col gap-8"
    >
      <input type="hidden" name="profileId" value={profile.id} />

      {canEdit && <SaveStatus status={status} onRetry={saveNow} />}

      <CompletenessBar percent={completeness} />

      {!canEdit && (
        <p role="status" className="rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
          View only. Ask an owner for edit access.
        </p>
      )}

      {/*
        Disabled on canEdit alone. Disabling it while a save is in flight would
        blur whatever the user is typing in every 800ms, which is the failure
        the old Save button never had.
      */}
      <fieldset disabled={!canEdit} className="flex flex-col gap-8">
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
            <p className="mt-1 text-xs text-muted-2">Two-letter code.</p>
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
                <span className="text-xs text-muted-2">Custom key. An application form may point at it.</span>
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

      {canEdit && <SaveStatus status={status} onRetry={saveNow} failuresOnly />}
    </form>
  )
}

// #region layout pieces

/**
 * The only thing left where a Save button was.
 *
 * Nothing here is pinned. A sticky bar is what made the old Save button
 * unusable: an on-screen keyboard shrinks the visual viewport, so a
 * bottom-pinned element pops in and out on every scroll. Pinning it to the top
 * instead would put it under the site header, which is already sticky at z-50.
 * So it sits in the flow, at a fixed height so a status change never moves the
 * field under the cursor, and it is rendered twice: once above the fields and,
 * when a save has failed, once below them. A failure is the one state where the
 * user has text that is not stored, so it is the one worth saying twice.
 */
function SaveStatus({
  status,
  onRetry,
  failuresOnly,
}: {
  status: SaveStatus
  onRetry: () => void
  /** The copy below the fields, which stays out of the way unless something broke. */
  failuresOnly?: boolean
}) {
  if (status.kind === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-frc/30 bg-frc/10 px-3 py-2">
        {/* role=alert, not status: this is the message that costs the user
            something, so a screen reader should interrupt for it. Only the
            first copy announces, or it is read out twice. */}
        <span role={failuresOnly ? undefined : 'alert'} className="text-sm text-frc">
          Not saved. {status.message}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-frc/40 px-2.5 py-1 text-sm font-medium text-frc transition-colors hover:bg-frc/10"
        >
          Retry
        </button>
      </div>
    )
  }

  if (failuresOnly) return null

  return (
    <div className="flex min-h-9 items-center">
      <span role="status" className="text-sm text-muted-2">
        {status.kind === 'saving'
          ? 'Saving…'
          : status.kind === 'saved'
            ? 'Saved'
            : status.dirty
              ? 'Not saved yet'
              : 'Saves as you type'}
      </span>
    </div>
  )
}

function Group({ groupKey, children }: { groupKey: ProfileGroupKey; children: React.ReactNode }) {
  const group = PROFILE_GROUPS.find((g) => g.key === groupKey)
  if (!group) return null
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">{group.title}</h2>
      {group.blurb && <p className="mt-1 max-w-2xl text-sm text-muted">{group.blurb}</p>}
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

/**
 * Live percentage only. It used to also report the stored value when the two
 * disagreed, which was there to tell you that you had unsaved work. Autosave
 * and the status bar answer that now.
 */
function CompletenessBar({ percent }: { percent: number }) {
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
    </div>
  )
}

// #endregion
