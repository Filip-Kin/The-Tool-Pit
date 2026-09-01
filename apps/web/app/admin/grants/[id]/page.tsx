import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import {
  grantChanges,
  grantCycles,
  grantFormFields,
  grantFunders,
  grantRequirements,
  grants,
  GRANT_REQUIREMENT_KINDS,
  GRANT_REQUIREMENT_OPERATORS,
} from '@the-tool-pit/db'
import { requirementValueToInput } from '@/lib/admin/grants'
import { AdminFormFieldEditor } from '@/components/grants/admin-form-field-editor'
import type { FormFieldRowDraft } from '@/components/grants/admin-form-field-editor'
import type { GrantFieldFillKind } from '@the-tool-pit/db/grant-enums'
import { CycleFields, Field, GrantFields, inputClass } from '../grant-fields'
import { ConfirmSubmit } from './confirm-submit'
import {
  deleteCycleAction,
  deleteRequirementAction,
  saveCycleForm,
  saveGrantApplicationUrl,
  saveGrantForm,
  saveGrantFormFieldMap,
  saveRequirementForm,
  setGrantStatusAction,
  verifyGrantAction,
} from './actions'

/**
 * Full editor for one grant: the listing, its cycles, its requirements and its
 * application prefill map.
 *
 * "Verify" sits at the top and is its own button, separate from Save, because
 * the public listing renders "verified on <date>" and that line is a claim
 * about a person, not about the last time a field was touched. Publishing is
 * refused until the listing has been verified at least once.
 */
export default async function AdminGrantEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; saved?: string }>
}) {
  await assertAdmin()
  const { id } = await params
  const { error, saved } = await searchParams

  const db = getDb()
  const [row] = await db
    .select({ grant: grants, funderName: grantFunders.name })
    .from(grants)
    .leftJoin(grantFunders, eq(grantFunders.id, grants.funderId))
    .where(eq(grants.id, id))
    .limit(1)
  if (!row) notFound()
  const grant = row.grant

  const [cycles, requirements, formFields, pendingChanges] = await Promise.all([
    db.select().from(grantCycles).where(eq(grantCycles.grantId, id)).orderBy(desc(grantCycles.cycleYear)),
    db.select().from(grantRequirements).where(eq(grantRequirements.grantId, id)).orderBy(asc(grantRequirements.sortOrder)),
    db.select().from(grantFormFields).where(eq(grantFormFields.grantId, id)).orderBy(asc(grantFormFields.sortOrder)),
    db
      .select({ id: grantChanges.id })
      .from(grantChanges)
      .where(and(eq(grantChanges.grantId, id), eq(grantChanges.status, 'pending')))
      .limit(50),
  ])
  const pendingChangeCount = pendingChanges.length

  const saveAction = saveGrantForm.bind(null, id)
  const verifyAction = verifyGrantAction.bind(null, id)
  const newCycleAction = saveCycleForm.bind(null, id, '')
  const newRequirementAction = saveRequirementForm.bind(null, id, '')

  const initialFields: FormFieldRowDraft[] = formFields.map((f) => ({
    id: f.id,
    fillKind: f.fillKind as GrantFieldFillKind,
    paramName: f.paramName ?? '',
    profilePath: f.profilePath,
    label: f.label ?? '',
    notes: f.notes ?? '',
    sortOrder: f.sortOrder,
  }))

  return (
    <div className="flex max-w-5xl flex-col gap-6 p-8">
      {/* #region header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/grants" className="text-xs text-muted hover:text-foreground">
            ← Grants
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">{grant.name}</h1>
          <p className="mt-0.5 text-xs text-muted-2">
            /grants/{grant.slug} · {grant.status}
            {row.funderName && ` · ${row.funderName}`}
          </p>
          <p className="mt-1 text-xs text-muted">
            {grant.verifiedAt
              ? `Verified ${new Date(grant.verifiedAt).toLocaleDateString()} by ${grant.verifiedBy ?? 'unknown'}`
              : 'Never verified by a person. It cannot be published until it is.'}
            {grant.lastCheckedAt && ` · crawler last fetched ${new Date(grant.lastCheckedAt).toLocaleDateString()}`}
            {grant.checkFailureCount > 0 && ` · ${grant.checkFailureCount} consecutive fetch failures`}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <form action={verifyAction}>
            <ConfirmSubmit
              message="Stamp this listing as checked by you, today? Only do this if you have just read the funder's page."
              className="rounded-md bg-rookie/20 px-3 py-1.5 text-xs font-medium text-rookie transition-colors hover:bg-rookie/35"
            >
              Verify now
            </ConfirmSubmit>
          </form>
          {grant.status !== 'published' && (
            <form action={setGrantStatusAction.bind(null, id, 'published')}>
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
              >
                Publish
              </button>
            </form>
          )}
          {grant.status === 'published' && (
            <form action={setGrantStatusAction.bind(null, id, 'pending')}>
              <ConfirmSubmit
                message="Take this off the public list? Teams with it saved will stop seeing it."
                className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                Unpublish
              </ConfirmSubmit>
            </form>
          )}
          <form action={setGrantStatusAction.bind(null, id, 'archived')}>
            <ConfirmSubmit
              message="Archive this grant? Use it when the programme has ended for good, so it does not get rediscovered every crawl."
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              Archive
            </ConfirmSubmit>
          </form>
        </div>
      </div>

      {error && <p className="rounded-lg border border-frc/40 bg-frc/10 p-3 text-sm text-frc">{error}</p>}
      {saved && !error && <p className="rounded-lg border border-rookie/40 bg-rookie/10 p-3 text-sm text-rookie">{saved}</p>}
      {pendingChangeCount > 0 && (
        <p className="rounded-lg border border-official/40 bg-official/10 p-3 text-sm text-official">
          This grant has filed changes waiting on review.{' '}
          <Link href="/admin/grants/changes" className="underline">
            Open the change queue
          </Link>
          .
        </p>
      )}
      {/* #endregion */}

      {/* #region listing */}
      <form action={saveAction} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Listing</h2>
        <Field
          label="Slug"
          hint="The public URL. Changing it breaks every existing link and bookmark, so it does not follow the name."
        >
          <input name="slug" defaultValue={grant.slug} className={inputClass} />
        </Field>
        <GrantFields
          defaults={{
            name: grant.name,
            funderName: row.funderName,
            summary: grant.summary,
            description: grant.description,
            infoUrl: grant.infoUrl,
            applicationUrl: grant.applicationUrl,
            applyMethod: grant.applyMethod,
            contactEmail: grant.contactEmail,
            mailingAddress: grant.mailingAddress,
            programs: grant.programs,
            geoScope: grant.geoScope,
            countries: grant.countries,
            regions: grant.regions,
            localityNote: grant.localityNote,
            awardMin: grant.awardMin,
            awardMax: grant.awardMax,
            awardCurrency: grant.awardCurrency,
            awardNotes: grant.awardNotes,
            renewable: grant.renewable,
            deadlineType: grant.deadlineType,
            effortLevel: grant.effortLevel,
            status: grant.status,
          }}
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Save listing
          </button>
          <span className="text-xs text-muted-2">
            Saving does not move the verified date. Use Verify for that.
          </span>
        </div>
      </form>
      {/* #endregion */}

      {/* #region cycles */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Cycles</h2>
          <p className="mt-1 text-xs text-muted-2">
            One row per year. Saving a cycle stamps its own verified date, separate from the listing&rsquo;s,
            because dates go stale faster than a description does.
          </p>
        </div>

        {cycles.length === 0 ? (
          <p className="text-xs text-muted">No cycles. The listing shows no dates at all, which is the honest state until the funder publishes some.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {cycles.map((c) => (
              <details key={c.id} className="rounded-lg border border-border-subtle bg-surface-2 p-3">
                <summary className="cursor-pointer text-xs text-foreground">
                  <span className="font-semibold">{c.cycleYear}</span>
                  <span className="text-muted"> · {c.status}</span>
                  <span className="text-muted">
                    {c.deadlineAt
                      ? ` · closes ${new Date(c.deadlineAt).toISOString().replace('.000Z', 'Z')} (UTC)`
                      : ' · no deadline recorded'}
                  </span>
                  {c.isEstimated && <span className="text-official"> · estimated</span>}
                  <span className="text-muted-2">
                    {c.verifiedAt
                      ? ` · verified ${new Date(c.verifiedAt).toLocaleDateString()} by ${c.verifiedBy ?? 'unknown'}`
                      : ' · unverified'}
                  </span>
                </summary>

                <form action={saveCycleForm.bind(null, id, c.id)} className="mt-3 flex flex-col gap-4">
                  <CycleFields
                    defaults={{
                      cycleYear: c.cycleYear,
                      opensAt: c.opensAt,
                      deadlineAt: c.deadlineAt ? new Date(c.deadlineAt).toISOString() : '',
                      deadlineNote: c.deadlineNote,
                      decisionAt: c.decisionAt,
                      status: c.status,
                      amountNote: c.amountNote,
                      sourceUrl: c.sourceUrl,
                      isEstimated: c.isEstimated,
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
                    >
                      Save {c.cycleYear}
                    </button>
                  </div>
                </form>

                <form action={deleteCycleAction.bind(null, id, c.id)} className="mt-2">
                  <ConfirmSubmit
                    message={`Delete the ${c.cycleYear} cycle? Its dates and history go with it.`}
                    className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:text-frc"
                  >
                    Delete this cycle
                  </ConfirmSubmit>
                </form>
              </details>
            ))}
          </div>
        )}

        <details className="rounded-lg border border-dashed border-border p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">Add a cycle</summary>
          <form action={newCycleAction} className="mt-3 flex flex-col gap-4">
            <CycleFields defaults={{ sourceUrl: grant.infoUrl }} />
            <button
              type="submit"
              className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Add cycle
            </button>
          </form>
        </details>
      </section>
      {/* #endregion */}

      {/* #region requirements */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Requirements</h2>
          <p className="mt-1 text-xs text-muted-2">
            Blocking rules rule a team out, so only use them for something the funder actually states.
            Anything the matcher cannot test goes in as kind &ldquo;other&rdquo;, which renders as prose and never
            excludes anyone.
          </p>
        </div>

        {requirements.length === 0 ? (
          <p className="text-xs text-muted">No requirements recorded.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {requirements.map((r) => (
              <div key={r.id} className="rounded-lg border border-border-subtle bg-surface-2 p-3">
                <form action={saveRequirementForm.bind(null, id, r.id)} className="flex flex-col gap-3">
                  <RequirementInputs
                    defaults={{
                      kind: r.kind,
                      operator: r.operator,
                      value: requirementValueToInput(r.value),
                      label: r.label,
                      isBlocking: r.isBlocking,
                      sortOrder: r.sortOrder,
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="rounded border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
                    >
                      Save
                    </button>
                  </div>
                </form>
                <form action={deleteRequirementAction.bind(null, id, r.id)} className="mt-2">
                  <ConfirmSubmit
                    message={`Delete the requirement "${r.label}"?`}
                    className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:text-frc"
                  >
                    Delete
                  </ConfirmSubmit>
                </form>
              </div>
            ))}
          </div>
        )}

        <details className="rounded-lg border border-dashed border-border p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">Add a requirement</summary>
          <form action={newRequirementAction} className="mt-3 flex flex-col gap-3">
            <RequirementInputs defaults={{ sortOrder: requirements.length }} />
            <button
              type="submit"
              className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Add requirement
            </button>
          </form>
        </details>
      </section>
      {/* #endregion */}

      {/* #region form field map */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Application prefill map</h2>
          <p className="mt-1 text-xs text-muted-2">
            We cannot type into someone else&rsquo;s form, so a prefill is a URL we build. Paste the funder&rsquo;s
            own pre-filled link and point each recovered parameter at a team profile field.
          </p>
        </div>
        <AdminFormFieldEditor
          grantId={id}
          applicationUrl={grant.applicationUrl}
          initialFields={initialFields}
          onSave={saveGrantFormFieldMap}
          onSaveApplicationUrl={saveGrantApplicationUrl}
        />
      </section>
      {/* #endregion */}
    </div>
  )
}

/**
 * The four columns of one requirement. Kept here rather than in
 * grant-fields.tsx because it is the only screen that edits them, and the
 * single value box is deliberate: the operator already says what shape the
 * value must be, and parseRequirementFields() refuses a mismatch instead of
 * storing a string the matcher would silently fail to compare.
 */
function RequirementInputs({
  defaults = {},
}: {
  defaults?: {
    kind?: string
    operator?: string
    value?: string
    label?: string
    isBlocking?: boolean
    sortOrder?: number
  }
}) {
  const d = defaults
  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Kind">
          <select name="kind" defaultValue={d.kind ?? 'other'} className={inputClass}>
            {GRANT_REQUIREMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Operator">
          <select name="operator" defaultValue={d.operator ?? 'is'} className={inputClass}>
            {GRANT_REQUIREMENT_OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Value" hint="Comma-separated for in / not_in. Blank for exists.">
          <input name="value" defaultValue={d.value ?? ''} className={inputClass} />
        </Field>
        <Field label="Sort order">
          <input name="sortOrder" defaultValue={d.sortOrder ?? 0} inputMode="numeric" className={inputClass} />
        </Field>
      </div>
      <Field label="Label" hint="The funder's own words. This is what a team reads on the listing.">
        <input name="label" defaultValue={d.label ?? ''} required className={inputClass} />
      </Field>
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input name="isBlocking" type="checkbox" defaultChecked={d.isBlocking ?? false} className="mt-0.5 accent-primary" />
        <span>
          Blocking: failing this rules a team out.
          <span className="block text-[10px] text-muted-2">
            Leave it off unless the funder states it as a hard rule. Kind &ldquo;other&rdquo; can never block.
          </span>
        </span>
      </label>
    </>
  )
}
