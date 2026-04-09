'use client'

import { useState, useTransition } from 'react'
import { scanDuplicates, mergeDuplicate, resolveWithAI } from './actions'
import type { DupeGroup } from './actions'

export function DedupPanel() {
  const [scanning, startScan] = useTransition()
  const [merging, startMerge] = useTransition()
  const [resolving, startResolve] = useTransition()
  const [groups, setGroups] = useState<DupeGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Map of groupIndex → chosen canonical ID
  const [selections, setSelections] = useState<Record<number, string>>({})
  const [mergedIndices, setMergedIndices] = useState<Set<number>>(new Set())
  const [mergeError, setMergeError] = useState<Record<number, string>>({})

  function handleScan() {
    setError(null)
    setGroups(null)
    setSelections({})
    setMergedIndices(new Set())
    startScan(async () => {
      const res = await scanDuplicates()
      if (res.error) {
        setError(res.error)
      } else {
        setGroups(res.groups ?? [])
        // Default canonical = first tool in each group (server sorts oldest first)
        const defaults: Record<number, string> = {}
        for (const [i, g] of (res.groups ?? []).entries()) {
          defaults[i] = g.tools[0]?.id ?? ''
        }
        setSelections(defaults)
      }
    })
  }

  function handleMerge(groupIndex: number) {
    const group = groups?.[groupIndex]
    if (!group) return
    const canonicalId = selections[groupIndex]
    if (!canonicalId) return
    const duplicateIds = group.tools.filter((t) => t.id !== canonicalId).map((t) => t.id)
    if (duplicateIds.length === 0) return

    setMergeError((prev) => ({ ...prev, [groupIndex]: '' }))
    startMerge(async () => {
      const res = await mergeDuplicate(canonicalId, duplicateIds)
      if (res.error) {
        setMergeError((prev) => ({ ...prev, [groupIndex]: res.error! }))
      } else {
        setMergedIndices((prev) => new Set(prev).add(groupIndex))
      }
    })
  }

  const pendingGroups = groups?.filter((_, i) => !mergedIndices.has(i)) ?? []

  function handleResolveWithAI() {
    if (!groups || groups.length === 0) return
    const pending = groups.filter((_, i) => !mergedIndices.has(i))
    const pendingIndices = groups.map((_, i) => i).filter((i) => !mergedIndices.has(i))
    startResolve(async () => {
      const res = await resolveWithAI(pending)
      if (res.error) {
        setError(res.error)
      } else if (res.selections) {
        // Map from pending-group index back to original group index
        const newSelections: Record<number, string> = { ...selections }
        for (const [pendingIdx, toolId] of Object.entries(res.selections)) {
          const origIdx = pendingIndices[parseInt(pendingIdx, 10)]
          if (origIdx !== undefined) newSelections[origIdx] = toolId
        }
        setSelections(newSelections)
      }
    })
  }

  return (
    <section className="rounded-lg border border-border p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Duplicate Tools</h2>
          <p className="text-xs text-muted mt-0.5">
            Finds published tools sharing the same homepage URL or a very similar name (&gt;85% similarity).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingGroups.length > 0 && (
            <button
              onClick={handleResolveWithAI}
              disabled={resolving || merging}
              className="rounded-md bg-surface-2 border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface transition-colors disabled:opacity-50"
            >
              {resolving ? 'Thinking…' : '✨ Auto-pick with AI'}
            </button>
          )}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="rounded-md bg-surface-2 border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface transition-colors disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan for Duplicates'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-frc">{error}</p>}

      {groups !== null && pendingGroups.length === 0 && (
        <p className="text-xs text-muted">
          {mergedIndices.size > 0
            ? `All ${mergedIndices.size} duplicate group(s) merged.`
            : 'No duplicates found.'}
        </p>
      )}

      {pendingGroups.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups!.map((group, i) => {
            if (mergedIndices.has(i)) return null
            const canonical = selections[i]
            return (
              <div key={i} className="rounded-md border border-border-subtle overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-surface-2 border-b border-border-subtle">
                  <span className="text-xs text-muted">
                    Match method:{' '}
                    <span className="font-medium text-foreground capitalize">{group.method}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {mergeError[i] && (
                      <span className="text-xs text-frc">{mergeError[i]}</span>
                    )}
                    <button
                      onClick={() => handleMerge(i)}
                      disabled={merging || !canonical}
                      className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
                    >
                      {merging ? 'Merging…' : 'Merge'}
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-muted text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left w-8">Keep</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">URL</th>
                      <th className="px-3 py-2 text-left">Published</th>
                      <th className="px-3 py-2 text-right">Votes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.tools.map((tool) => (
                      <tr
                        key={tool.id}
                        className={`border-t border-border-subtle ${canonical === tool.id ? 'bg-surface' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="radio"
                            name={`canonical-${i}`}
                            checked={canonical === tool.id}
                            onChange={() =>
                              setSelections((prev) => ({ ...prev, [i]: tool.id }))
                            }
                            className="accent-primary"
                          />
                        </td>
                        <td className="px-3 py-2 text-xs font-medium text-foreground">
                          <a
                            href={`/admin/tools/${tool.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {tool.name}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted truncate max-w-xs">
                          {tool.homepageUrl ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {tool.publishedAt
                            ? new Date(tool.publishedAt).toLocaleDateString()
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-muted">{tool.votes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
