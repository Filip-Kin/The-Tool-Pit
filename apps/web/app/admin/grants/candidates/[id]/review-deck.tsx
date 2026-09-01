'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  GRANT_APPLY_METHODS,
  GRANT_CYCLE_STATUSES,
  GRANT_DEADLINE_TYPES,
  GRANT_EFFORT_LEVELS,
  GRANT_GEO_SCOPES,
  GRANT_PROGRAMS,
  GRANT_REJECTION_KINDS,
  GRANT_REJECTION_KIND_LABELS,
  GRANT_STATUSES,
  GRANT_TRI_STATES,
} from '@the-tool-pit/db/grant-enums'
import type { GrantRejectionKind } from '@the-tool-pit/db/grant-enums'
import type { EvidenceMap, FieldEvidence, ReviewDefaults } from '@/lib/admin/grant-review'
import { flagGrantCandidate, suppressGrantCandidate } from '../actions'

/**
 * The review deck. One candidate, full screen, three answers.
 *
 * It replaces a form that a moderator filled in by hand off a page they had to
 * read themselves. That does not survive 280 candidates, so the model fills the
 * record first and this screen is where a person CONFIRMS it. Everything is
 * editable in place: correcting a wrong date is typing in the box next to the
 * quote it came from, not opening another form.
 *
 * Every prefilled value shows the sentence it came off and which text that was.
 * A quote from the funder's own page and a quote from a grants database are not
 * worth the same, and a moderator has to be able to see which one they are
 * about to publish. Where the two disagreed, the funder's page is what is in
 * the box and the disagreement is printed under it.
 *
 * The three actions are three different signals, not three ways of leaving:
 *   Approve  - publish it.
 *   Suppress - a labelled negative example. The bucket goes back to the
 *              classifier so the same page shape stops arriving.
 *   Flag     - probably a real grant, badly read. Queues a deeper re-read and
 *              keeps the row in the queue.
 *
 * Each one advances to the next candidate, so the queue is a deck to move
 * through rather than a list to keep coming back to.
 */

// #region evidence rendering

const SOURCE_LABEL: Record<string, string> = {
  funder_page: 'funder page',
  aggregator: 'third-party summary',
}

function Evidence({ evidence }: { evidence?: FieldEvidence }) {
  if (!evidence) return null
  return (
    <span className="mt-1 flex flex-col gap-0.5">
      {evidence.quote && (
        <span className="flex items-start gap-1.5 text-[10px] leading-snug">
          <span
            className={`mt-px shrink-0 rounded px-1 py-px font-medium uppercase tracking-wide ${
              evidence.source === 'funder_page'
                ? 'bg-rookie/20 text-rookie'
                : 'bg-official/20 text-official'
            }`}
          >
            {SOURCE_LABEL[evidence.source ?? ''] ?? 'unsourced'}
          </span>
          <span className="min-w-0 break-words italic text-muted">“{evidence.quote}”</span>
        </span>
      )}
      {evidence.conflict && (
        <span className="text-[10px] leading-snug text-frc">Sources disagree: {evidence.conflict}</span>
      )}
    </span>
  )
}

const inputClass =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary'

function DeckField({
  label,
  hint,
  evidence,
  children,
}: {
  label: string
  hint?: string
  evidence?: FieldEvidence
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-muted-2">{hint}</span>}
      <Evidence evidence={evidence} />
    </label>
  )
}

/** yes / no / unknown, and unknown is a real answer rather than an empty box. */
function TriStateField({
  label,
  name,
  defaultValue,
  evidence,
}: {
  label: string
  name: string
  defaultValue: string
  evidence?: FieldEvidence
}) {
  return (
    <DeckField label={label} evidence={evidence} hint={defaultValue === 'unknown' ? 'Not stated on the page we read.' : undefined}>
      <select name={name} defaultValue={defaultValue} className={inputClass}>
        {GRANT_TRI_STATES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </DeckField>
  )
}

// #endregion

export interface ReviewDeckProps {
  candidateId: string
  url: string
  defaults: ReviewDefaults
  evidence: EvidenceMap
  /** Where the next candidate is, so an action lands on it. */
  nextCandidateId: string | null
  position: number
  queueTotal: number
  queueStatus: string
  /** Bound server action for the approve form. */
  approveAction: (form: FormData) => void | Promise<void>
  fill: { filled: number; total: number; quoted: number }
  extractedAt: string | null
  extractionDepth: string | null
  extractionNotes: string[]
  extractionReasoning: string | null
  alreadyMatched: boolean
  error?: string
  /** Server-rendered panels for the sidebar: provenance, the page text. */
  children?: React.ReactNode
}

export function ReviewDeck(props: ReviewDeckProps) {
  const { defaults: d, evidence: ev } = props
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, start] = useTransition()
  const [panel, setPanel] = useState<'none' | 'suppress' | 'flag'>('none')
  const [reason, setReason] = useState('')
  const [kind, setKind] = useState<GrantRejectionKind>('not_a_grant')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(props.error ?? null)

  const goNext = () => {
    if (props.nextCandidateId) router.push(`/admin/grants/candidates/${props.nextCandidateId}`)
    else router.push(`/admin/grants/candidates?status=${props.queueStatus}`)
  }

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res.error) {
        setError(res.error)
        return
      }
      goNext()
    })
  }

  // Keyboard, because a deck is only faster than a list if your hands stay
  // still. Ignored while typing, so a reason containing an "s" does not
  // suppress the row it is being typed into.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return

      if (event.key === 'a') {
        event.preventDefault()
        formRef.current?.requestSubmit()
      } else if (event.key === 's') {
        event.preventDefault()
        setPanel((p) => (p === 'suppress' ? 'none' : 'suppress'))
      } else if (event.key === 'f') {
        event.preventDefault()
        setPanel((p) => (p === 'flag' ? 'none' : 'flag'))
      } else if (event.key === 'j' || event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (event.key === 'Escape') {
        setPanel('none')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <form ref={formRef} action={props.approveAction} className="flex min-h-screen flex-col">
      <input type="hidden" name="nextCandidateId" value={props.nextCandidateId ?? ''} />

      {/* #region header */}
      <header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-surface/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-2">
              {props.position} of {props.queueTotal} {props.queueStatus}
            </p>
            <h1 className="truncate text-xl font-bold text-foreground">{d.name || 'Unnamed candidate'}</h1>
            <a
              href={props.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs text-primary hover:underline"
            >
              {props.url}
            </a>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-rookie px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40"
            >
              Approve <span className="opacity-60">(a)</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setPanel(panel === 'flag' ? 'none' : 'flag')}
              className="rounded-md bg-official/20 px-4 py-2.5 text-sm font-semibold text-official transition-colors hover:bg-official/35 disabled:opacity-40"
            >
              Flag <span className="opacity-60">(f)</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setPanel(panel === 'suppress' ? 'none' : 'suppress')}
              className="rounded-md bg-frc/20 px-4 py-2.5 text-sm font-semibold text-frc transition-colors hover:bg-frc/35 disabled:opacity-40"
            >
              Suppress <span className="opacity-60">(s)</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={goNext}
              className="rounded-md border border-border px-3 py-2.5 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-40"
            >
              Skip <span className="opacity-60">(j)</span>
            </button>
          </div>
        </div>

        <p className="text-[11px] text-muted-2">
          {props.extractedAt
            ? `Read by the extractor ${new Date(props.extractedAt).toLocaleString()} (${props.extractionDepth}). ` +
              `${props.fill.filled} of ${props.fill.total} fields filled, ${props.fill.quoted} with a quote. ` +
              'Everything below is editable. Check a value against its quote before approving.'
            : 'No extraction on this candidate yet, so the boxes are the classifier’s guesses. Flag it to queue a read.'}
        </p>

        {props.alreadyMatched && (
          <p className="rounded-lg border border-official/40 bg-official/10 p-2 text-xs text-official">
            This candidate is already attached to a grant. Edit that grant instead of publishing a second copy.
          </p>
        )}
        {error && <p className="rounded-lg border border-frc/40 bg-frc/10 p-2 text-xs text-frc">{error}</p>}

        {panel === 'suppress' && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-frc/40 bg-frc/5 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Why</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as GrantRejectionKind)}
                className={inputClass}
              >
                {GRANT_REJECTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {GRANT_REJECTION_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[18rem] flex-1 flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                In your own words (this is what the submitter is told)
              </span>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={inputClass}
              />
            </label>
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(() => suppressGrantCandidate(props.candidateId, reason, kind))}
              className="rounded-md bg-frc px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pending ? '…' : 'Suppress and go on'}
            </button>
            <span className="w-full text-[10px] text-muted-2">
              The bucket goes back to the classifier as an example of what to reject.
            </span>
          </div>
        )}

        {panel === 'flag' && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-official/40 bg-official/5 p-3">
            <label className="flex min-w-[24rem] flex-1 flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                What is wrong or missing
              </span>
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </label>
            <button
              type="button"
              disabled={pending || !note.trim()}
              onClick={() => run(() => flagGrantCandidate(props.candidateId, note))}
              className="rounded-md bg-official px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pending ? '…' : 'Flag and go on'}
            </button>
            <span className="w-full text-[10px] text-muted-2">
              Not a rejection. The row stays in the queue and comes back with a deeper read: the page again, the
              application link, and other surfaces describing the same grant.
            </span>
          </div>
        )}
      </header>
      {/* #endregion */}

      <div className="grid flex-1 gap-6 p-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          {/* #region the listing */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">The listing</h2>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <DeckField label="Name" evidence={ev.name}>
                  <input name="name" defaultValue={d.name} required className={inputClass} />
                </DeckField>
                <DeckField label="Funder" evidence={ev.funderName}>
                  <input name="funderName" defaultValue={d.funderName} className={inputClass} />
                </DeckField>
              </div>

              <DeckField label="Summary" hint="One or two sentences. This is the whole card." evidence={ev.summary}>
                <input name="summary" defaultValue={d.summary} maxLength={300} className={inputClass} />
              </DeckField>

              <DeckField label="Description" hint="Markdown, shown on the detail page." evidence={ev.description}>
                <textarea name="description" defaultValue={d.description} rows={6} className={inputClass} />
              </DeckField>

              <div className="grid gap-4 md:grid-cols-2">
                <DeckField label="Info URL">
                  <input name="infoUrl" defaultValue={d.infoUrl} required className={inputClass} />
                </DeckField>
                <DeckField label="Application URL" evidence={ev.applicationUrl}>
                  <input name="applicationUrl" defaultValue={d.applicationUrl} className={inputClass} />
                </DeckField>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <DeckField label="How to apply" evidence={ev.applyMethod}>
                  <select name="applyMethod" defaultValue={d.applyMethod} className={inputClass}>
                    {GRANT_APPLY_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </DeckField>
                <DeckField label="Contact email" evidence={ev.contactEmail}>
                  <input name="contactEmail" defaultValue={d.contactEmail} className={inputClass} />
                </DeckField>
                <DeckField label="Mailing address" evidence={ev.mailingAddress}>
                  <input name="mailingAddress" defaultValue={d.mailingAddress} className={inputClass} />
                </DeckField>
              </div>

              <DeckField label="Programs" evidence={ev.programs}>
                <span className="flex flex-wrap gap-3 pt-1">
                  {GRANT_PROGRAMS.map((p) => (
                    <span key={p} className="flex items-center gap-1.5 text-xs text-foreground">
                      <input
                        type="checkbox"
                        name="programs"
                        value={p}
                        defaultChecked={d.programs.includes(p)}
                        className="accent-primary"
                      />
                      {p}
                    </span>
                  ))}
                </span>
              </DeckField>
            </div>
          </section>
          {/* #endregion */}

          {/* #region money */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-1 text-sm font-semibold text-foreground">The money</h2>
            <p className="mb-4 text-xs text-muted-2">
              The phrase matters more than the figures. “Varies” and “up to $5,000 in kind” are real answers, and an
              empty award line is what a team reads as “nobody knows”.
            </p>
            <div className="flex flex-col gap-4">
              <DeckField label="Award in the funder’s words" evidence={ev.awardPhrase}>
                <input name="awardNotes" defaultValue={d.awardNotes} className={inputClass} />
              </DeckField>
              <div className="grid gap-4 md:grid-cols-4">
                <DeckField label="Minimum" evidence={ev.awardMin}>
                  <input name="awardMin" defaultValue={d.awardMin ?? ''} inputMode="numeric" className={inputClass} />
                </DeckField>
                <DeckField label="Maximum" evidence={ev.awardMax}>
                  <input name="awardMax" defaultValue={d.awardMax ?? ''} inputMode="numeric" className={inputClass} />
                </DeckField>
                <DeckField label="Currency" evidence={ev.awardCurrency}>
                  <input name="awardCurrency" defaultValue={d.awardCurrency} className={inputClass} />
                </DeckField>
                <TriStateField label="Renewable" name="renewable" defaultValue={d.renewable} evidence={ev.renewable} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <DeckField label="Effort level" evidence={ev.effortLevel}>
                  <select name="effortLevel" defaultValue={d.effortLevel} className={inputClass}>
                    {GRANT_EFFORT_LEVELS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </DeckField>
                <DeckField label="On approve, save as" hint="Only 'published' is visible to teams.">
                  <select name="status" defaultValue="published" className={inputClass}>
                    {GRANT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </DeckField>
              </div>
            </div>
          </section>
          {/* #endregion */}

          {/* #region geography */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Who it is open to</h2>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                <DeckField label="Scope" evidence={ev.geoScope}>
                  <select name="geoScope" defaultValue={d.geoScope} className={inputClass}>
                    {GRANT_GEO_SCOPES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </DeckField>
                <DeckField label="Countries" hint="ISO codes, comma separated." evidence={ev.countries}>
                  <input name="countries" defaultValue={d.countries.join(', ')} className={inputClass} />
                </DeckField>
                <DeckField
                  label="Regions"
                  hint="Required for anything narrower than national."
                  evidence={ev.regions}
                >
                  <input name="regions" defaultValue={d.regions.join(', ')} className={inputClass} />
                </DeckField>
              </div>
              <DeckField label="Locality note" evidence={ev.localityNote}>
                <input name="localityNote" defaultValue={d.localityNote} className={inputClass} />
              </DeckField>

              <div className="grid gap-4 md:grid-cols-2">
                <TriStateField
                  label="Requires a 501(c)(3)"
                  name="req501c3"
                  defaultValue={d.eligibility.requires501c3}
                  evidence={ev.requires501c3}
                />
                <TriStateField
                  label="Requires an employee or member mentor"
                  name="reqEmployeeMentor"
                  defaultValue={d.eligibility.requiresEmployeeMentor}
                  evidence={ev.requiresEmployeeMentor}
                />
                <TriStateField
                  label="Rookie teams only"
                  name="reqRookieOnly"
                  defaultValue={d.eligibility.rookieOnly}
                  evidence={ev.rookieOnly}
                />
                <TriStateField
                  label="Must be a school team"
                  name="reqSchoolAffiliation"
                  defaultValue={d.eligibility.requiresSchoolAffiliation}
                  evidence={ev.requiresSchoolAffiliation}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <DeckField label="Ages or grades" evidence={ev.ageRange}>
                  <input name="reqAgeRange" defaultValue={d.eligibility.ageRange} className={inputClass} />
                </DeckField>
                <DeckField label="Geography in the funder’s words" evidence={ev.geographyRestriction}>
                  <input name="reqGeography" defaultValue={d.eligibility.geographyRestriction} className={inputClass} />
                </DeckField>
              </div>

              <DeckField
                label="Anything else about who may apply"
                hint="Saved as a note on the listing. It never rules a team out on its own."
                evidence={ev.eligibilityText}
              >
                <textarea
                  name="reqEligibilityText"
                  defaultValue={d.eligibility.eligibilityText}
                  rows={3}
                  className={inputClass}
                />
              </DeckField>
            </div>
          </section>
          {/* #endregion */}

          {/* #region dates */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-1 text-sm font-semibold text-foreground">This year’s cycle</h2>
            <p className="mb-4 text-xs text-muted-2">
              Leave the year blank to save the grant with no dates at all. A grant with no dates is still worth
              listing; an invented deadline is not.
            </p>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-4">
                <DeckField label="Cycle year" evidence={ev.cycleYear}>
                  <input name="cycleYear" defaultValue={d.cycleYear ?? ''} inputMode="numeric" className={inputClass} />
                </DeckField>
                <DeckField label="Opens (YYYY-MM-DD)" evidence={ev.opensAt}>
                  <input name="opensAt" defaultValue={d.opensAt} placeholder="2027-01-15" className={inputClass} />
                </DeckField>
                <DeckField label="Decision (YYYY-MM-DD)" evidence={ev.decisionAt}>
                  <input name="decisionAt" defaultValue={d.decisionAt} className={inputClass} />
                </DeckField>
                <DeckField label="Deadline type" evidence={ev.deadlineType}>
                  <select name="deadlineType" defaultValue={d.deadlineType} className={inputClass}>
                    {GRANT_DEADLINE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </DeckField>
              </div>

              <DeckField
                label="Deadline"
                hint="Needs the funder's own time and offset, e.g. 2027-03-01T23:59:00-05:00. A bare date is refused, because 11:59pm somewhere is not a deadline."
                evidence={ev.deadlineAt}
              >
                <input
                  name="deadlineAt"
                  defaultValue={d.deadlineAt}
                  placeholder="2027-03-01T23:59:00-05:00"
                  className={inputClass}
                />
              </DeckField>

              <div className="grid gap-4 md:grid-cols-2">
                <DeckField label="Deadline note" evidence={ev.deadlineNote}>
                  <input name="deadlineNote" defaultValue={d.deadlineNote} className={inputClass} />
                </DeckField>
                <DeckField label="Cycle status">
                  <select name="cycleStatus" defaultValue="unknown" className={inputClass}>
                    {GRANT_CYCLE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </DeckField>
              </div>
              <input type="hidden" name="cycleSourceUrl" value={props.url} />
            </div>
          </section>
          {/* #endregion */}
        </div>

        {/* #region what the extractor said */}
        <aside className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">What the extractor said</h3>
            {props.extractionReasoning && (
              <p className="mt-2 text-xs leading-snug text-muted">{props.extractionReasoning}</p>
            )}
            {props.extractionNotes.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {props.extractionNotes.map((n) => (
                  <li key={n} className="text-[10px] leading-snug text-muted-2">
                    {n}
                  </li>
                ))}
              </ul>
            )}
            {!props.extractionReasoning && props.extractionNotes.length === 0 && (
              <p className="mt-2 text-xs text-muted-2">Nothing recorded.</p>
            )}
          </div>
          {props.children}
        </aside>
        {/* #endregion */}
      </div>
    </form>
  )
}
