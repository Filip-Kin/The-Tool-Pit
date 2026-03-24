import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getToolForEdit } from '@/lib/admin/get-tool-for-edit'
import { saveTool, setToolStatus } from './actions'
import { SaveButton } from './save-button'

const TOOL_TYPES = [
  'web_app', 'desktop_app', 'mobile_app', 'calculator', 'spreadsheet',
  'github_project', 'browser_extension', 'api', 'resource', 'other',
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

  const linkByType = Object.fromEntries(tool.links.map((l) => [l.linkType, l.url]))

  const suppressAction = setToolStatus.bind(null, id, 'suppressed')
  const publishAction = setToolStatus.bind(null, id, 'published')
  const draftAction = setToolStatus.bind(null, id, 'draft')

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
        </div>
      </div>

      {/* Edit form */}
      <form action={(formData) => { void saveTool(undefined, formData) }} className="flex flex-col gap-6">
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
          </div>
        </section>

        {/* Links */}
        <section className="flex flex-col gap-4 rounded-lg border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground">Links</h2>
          {(['homepage', 'github', 'docs'] as const).map((type) => (
            <Field key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
              <input
                name={`link_${type}`}
                defaultValue={linkByType[type] ?? ''}
                type="url"
                className="input"
                placeholder={`https://`}
              />
            </Field>
          ))}
          {/* Other link types are read-only for now */}
          {tool.links.filter((l) => !['homepage', 'github', 'docs'].includes(l.linkType)).map((l) => (
            <div key={l.id} className="flex gap-2 items-center text-xs text-muted">
              <span className="w-20 shrink-0">{l.linkType}</span>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">{l.url}</a>
              <span className="text-muted-2">(read-only)</span>
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
