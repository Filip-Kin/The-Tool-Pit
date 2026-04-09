import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getToolForEdit } from '@/lib/admin/get-tool-for-edit'
import { saveTool, setToolStatus, reClassifyTool } from './actions'
import { SaveButton } from './save-button'
import { ReClassifyButton } from './re-classify-button'
import { getDb } from '@/lib/db'
import { toolSources, toolUpdates } from '@the-tool-pit/db'
import { eq, desc } from 'drizzle-orm'

const TOOL_TYPES = [
  'web_app', 'desktop_app', 'mobile_app', 'calculator', 'spreadsheet',
  'github_project', 'browser_extension', 'api', 'resource', 'vendor_website', 'other',
] as const

const FRESHNESS_STATES = [
  'active', 'stale', 'inactive', 'evergreen', 'seasonal', 'archived', 'unknown',
] as const

const PROGRAMS = ['frc', 'ftc', 'fll'] as const

const AUDIENCE_ROLES = [
  { slug: 'student', label: 'Student' },
  { slug: 'mentor', label: 'Mentor' },
  { slug: 'volunteer', label: 'Volunteer' },
  { slug: 'parent_newcomer', label: 'Parent / Newcomer' },
  { slug: 'organizer_staff', label: 'Organizer / Staff' },
]

const AUDIENCE_FUNCTIONS = [
  { slug: 'programmer', label: 'Programmer' },
  { slug: 'scouter', label: 'Scouter' },
  { slug: 'strategist', label: 'Strategist' },
  { slug: 'cad', label: 'CAD' },
  { slug: 'mechanical', label: 'Mechanical' },
  { slug: 'electrical', label: 'Electrical' },
  { slug: 'drive_team', label: 'Drive Team' },
  { slug: 'awards', label: 'Awards' },
  { slug: 'outreach', label: 'Outreach' },
  { slug: 'team_management', label: 'Team Management' },
  { slug: 'event_ops', label: 'Event Ops' },
  { slug: 'field_technical', label: 'Field Technical' },
  { slug: 'inspection', label: 'Inspection' },
  { slug: 'judging', label: 'Judging' },
]

export default async function AdminToolEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tool = await getToolForEdit(id)
  if (!tool) notFound()

  const db = getDb()
  const [sources, activityLog] = await Promise.all([
    db
      .select()
      .from(toolSources)
      .where(eq(toolSources.toolId, id))
      .orderBy(desc(toolSources.discoveredAt)),
    db
      .select()
      .from(toolUpdates)
      .where(eq(toolUpdates.toolId, id))
      .orderBy(desc(toolUpdates.signalAt))
      .limit(20),
  ])

  const linkByType = Object.fromEntries(tool.links.map((l) => [l.linkType, l.url]))
  const linkStatusByType = Object.fromEntries(tool.links.map((l) => [l.linkType, { isBroken: l.isBroken, lastCheckedAt: l.lastCheckedAt }]))

  const suppressAction = setToolStatus.bind(null, id, 'suppressed')
  const publishAction = setToolStatus.bind(null, id, 'published')
  const draftAction = setToolStatus.bind(null, id, 'draft')
  const reClassifyAction = reClassifyTool.bind(null, id)

  return (
    <div className="p-8 max-w-3xl flex flex-col gap-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/tools" className="text-xs text-muted hover:text-foreground">
            ← Tools
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">{tool.name}</h1>
          <p className="text-xs text-muted-2 mt-0.5">/tools/{tool.slug}</p>
        </div>

        {/* Quick status actions */}
        <div className="flex gap-2 shrink-0">
          {tool.status !== 'published' && (
            <form action={publishAction}>
              <button type="submit" className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors">
                Publish
              </button>
            </form>
          )}
          {tool.status !== 'draft' && (
            <form action={draftAction}>
              <button type="submit" className="rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground border border-border transition-colors">
                Set Draft
              </button>
            </form>
          )}
          {tool.status !== 'suppressed' && (
            <form action={suppressAction}>
              <button type="submit" className="rounded-md border border-red-600/40 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors">
                Suppress
              </button>
            </form>
          )}
          <ReClassifyButton action={reClassifyAction} />
        </div>
      </div>

      {/* Edit form */}
      <form action={saveTool} className="flex flex-col gap-6">
        <input type="hidden" name="toolId" value={tool.id} />

        {/* Core fields */}
        <section className="flex flex-col gap-4 rounded-lg border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground">Core</h2>

          <Field label="Name" required>
            <input
              name="name"
              defaultValue={tool.name}
              required
              className="input"
            />
          </Field>

          <Field label="Summary">
            <textarea
              name="summary"
              defaultValue={tool.summary ?? ''}
              rows={2}
              className="input resize-none"
              maxLength={300}
            />
          </Field>

          <Field label="Description (markdown)">
            <textarea
              name="description"
              defaultValue={tool.description ?? ''}
              rows={6}
              className="input resize-y font-mono text-xs"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Tool Type">
              <select name="toolType" defaultValue={tool.toolType} className="input">
                {TOOL_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>

            <Field label="Status">
              <select name="status" defaultValue={tool.status} className="input">
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="suppressed">Suppressed</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Freshness State">
              <select name="freshnessState" defaultValue={tool.freshnessState ?? 'unknown'} className="input">
                {FRESHNESS_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>

            <Field label="Vendor Name">
              <input
                name="vendorName"
                defaultValue={tool.vendorName ?? ''}
                className="input"
                placeholder="Only if isVendor"
              />
            </Field>
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" name="isOfficial" defaultChecked={tool.isOfficial} className="rounded" />
              Official
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" name="isVendor" defaultChecked={tool.isVendor} className="rounded" />
              Vendor
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" name="isRookieFriendly" defaultChecked={tool.isRookieFriendly} className="rounded" />
              Rookie Friendly
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" name="isTeamCode" defaultChecked={tool.isTeamCode} className="rounded" />
              Team Robot Code
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" name="isTeamCad" defaultChecked={tool.isTeamCad} className="rounded" />
              Team Robot CAD
            </label>
          </div>

          {/* Team Info — shown when isTeamCode might be checked */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Team Number">
              <input
                name="teamNumber"
                type="number"
                min="1"
                max="99999"
                defaultValue={tool.teamNumber ?? ''}
                placeholder="e.g. 254"
                className="input"
              />
            </Field>
            <Field label="Season Year">
              <input
                name="seasonYear"
                type="number"
                min="2000"
                max="2030"
                defaultValue={tool.seasonYear ?? ''}
                placeholder="e.g. 2024"
                className="input"
              />
            </Field>
          </div>
        </section>

        {/* Links */}
        <section className="flex flex-col gap-4 rounded-lg border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground">Links</h2>
          {(['homepage', 'github', 'docs', 'forum'] as const).map((type) => {
            const status = linkStatusByType[type]
            const typeLabel = type === 'forum' ? 'Chief Delphi Thread' : type.charAt(0).toUpperCase() + type.slice(1)
            return (
              <div key={type} className="flex flex-col gap-1">
                <Field label={typeLabel}>
                  <input
                    name={`link_${type}`}
                    defaultValue={linkByType[type] ?? ''}
                    type="url"
                    className="input"
                    placeholder={`https://`}
                  />
                </Field>
                {status?.isBroken && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    ⚠ Broken link detected
                    {status.lastCheckedAt && (
                      <span className="text-muted-2">
                        · checked {new Date(status.lastCheckedAt).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                )}
                {status && !status.isBroken && status.lastCheckedAt && (
                  <p className="text-xs text-muted-2">
                    Checked {new Date(status.lastCheckedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            )
          })}
          {/* Other link types are read-only for now */}
          {tool.links.filter((l) => !['homepage', 'github', 'docs'].includes(l.linkType)).map((l) => (
            <div key={l.id} className="flex gap-2 items-center text-xs text-muted">
              <span className="w-20 shrink-0">{l.linkType}</span>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">{l.url}</a>
              {l.isBroken ? (
                <span className="shrink-0 text-red-500">⚠ broken</span>
              ) : (
                <span className="text-muted-2 shrink-0">(read-only)</span>
              )}
            </div>
          ))}
        </section>

        {/* Programs */}
        <section className="flex flex-col gap-3 rounded-lg border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground">Programs</h2>
          <div className="flex gap-4">
            {PROGRAMS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  name="programs"
                  value={p}
                  defaultChecked={tool.programs.includes(p)}
                  className="rounded"
                />
                {p.toUpperCase()}
              </label>
            ))}
          </div>
        </section>

        {/* Audience */}
        <section className="flex flex-col gap-4 rounded-lg border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground">Audience</h2>

          <div>
            <p className="mb-2 text-xs font-medium text-muted">Roles</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {AUDIENCE_ROLES.map((r) => (
                <label key={r.slug} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    name="audienceRoles"
                    value={r.slug}
                    defaultChecked={tool.audienceRoles.includes(r.slug)}
                    className="rounded"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted">Functions</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {AUDIENCE_FUNCTIONS.map((f) => (
                <label key={f.slug} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    name="audienceFunctions"
                    value={f.slug}
                    defaultChecked={tool.audienceFunctions.includes(f.slug)}
                    className="rounded"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between">
          <Link
            href={`/tools/${tool.slug}`}
            target="_blank"
            className="text-xs text-muted hover:underline"
          >
            View public page ↗
          </Link>
          <SaveButton />
        </div>
      </form>

      {/* Admin Notes — internal only */}
      <section className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
        <h2 className="text-sm font-semibold text-foreground">Admin Notes <span className="text-xs font-normal text-muted">(internal only)</span></h2>
        <form action={saveTool}>
          <input type="hidden" name="toolId" value={tool.id} />
          <textarea
            name="adminNotes"
            defaultValue={tool.adminNotes ?? ''}
            rows={3}
            placeholder="Reason for suppression, review notes, etc."
            className="input w-full resize-y text-sm"
          />
          <div className="mt-2 flex justify-end">
            <SaveButton label="Save Notes" />
          </div>
        </form>
      </section>

      {/* Sources — read-only evidence records */}
      {sources.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground">Sources</h2>
          <div className="flex flex-col gap-2">
            {sources.map((s) => (
              <div key={s.id} className="flex flex-wrap gap-3 text-xs text-muted border-t border-border-subtle pt-2 first:border-t-0 first:pt-0">
                <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded shrink-0">{s.sourceType}</span>
                {s.sourceUrl ? (
                  <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline truncate flex-1">
                    {s.sourceUrl}
                  </a>
                ) : <span className="text-muted-2 flex-1">—</span>}
                <span className="text-muted-2 shrink-0">
                  {s.discoveredAt ? new Date(s.discoveredAt).toLocaleDateString() : '—'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Activity log — signals recorded by freshness / link-checker jobs */}
      <section className="flex flex-col gap-3 rounded-lg border border-border p-5">
        <h2 className="text-sm font-semibold text-foreground">Activity Log</h2>
        {activityLog.length === 0 ? (
          <p className="text-xs text-muted-2">No activity recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-0 divide-y divide-border-subtle">
            {activityLog.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center gap-3 py-2 text-xs text-muted first:pt-0 last:pb-0">
                <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded shrink-0 text-foreground">
                  {entry.signalType.replace(/_/g, ' ')}
                </span>
                <span className="text-muted-2 shrink-0">
                  {new Date(entry.signalAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
