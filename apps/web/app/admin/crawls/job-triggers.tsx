'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { triggerCrawl, triggerFreshnessCheckAll, triggerReindex, triggerReEnrichSuppressed, triggerRequeueNeedsReview, triggerReEnrichPublished } from './actions'

const CONNECTORS: { key: string; label: string; description: string }[] = [
  { key: 'github_topics', label: 'GitHub Topics', description: 'Repos tagged frc/ftc/fll' },
  { key: 'awesome_list', label: 'Awesome List', description: 'FRC awesome-list repos' },
  { key: 'fta_tools', label: 'FTA Tools', description: 'fta.tools scrape' },
  { key: 'volunteer_systems', label: 'Volunteer Systems', description: 'Volunteer-facing tools' },
  { key: 'chief_delphi', label: 'ChiefDelphi', description: 'CD forum GitHub links' },
  { key: 'tba_teams', label: 'TBA Teams', description: 'Team GitHub orgs via TBA' },
]

function useAction<T extends (...args: never[]) => Promise<{ error?: string }>>(
  action: T,
) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null)

  function run(...args: Parameters<T>) {
    setResult(null)
    startTransition(async () => {
      const res = await (action as unknown as (...a: unknown[]) => Promise<{ error?: string }>)(...args)
      setResult(res.error ? { error: res.error } : { ok: true })
      router.refresh()
    })
  }

  return { run, pending, result }
}

export function AdminJobTriggers() {
  const freshness = useAction(triggerFreshnessCheckAll)
  const reindex = useAction(triggerReindex)
  const reEnrich = useAction(triggerReEnrichSuppressed)
  const reEnrichPublished = useAction(triggerReEnrichPublished)
  const requeueReview = useAction(triggerRequeueNeedsReview)
  const crawl = useAction(triggerCrawl)
  const [lastCrawlConnector, setLastCrawlConnector] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      {/* Maintenance */}
      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Maintenance</h2>
        <div className="flex flex-wrap gap-3">
          <TriggerButton
            label="Re-classify All Published"
            description="Re-scrapes and re-classifies every published candidate with the latest pipeline (picks up new types like vendor_website)"
            pending={reEnrichPublished.pending}
            result={reEnrichPublished.result}
            onClick={() => reEnrichPublished.run()}
          />
          <TriggerButton
            label="Re-enrich All Suppressed"
            description="Re-scrapes every suppressed candidate and re-runs classification with the latest pipeline"
            pending={reEnrich.pending}
            result={reEnrich.result}
            onClick={() => reEnrich.run()}
          />
          <TriggerButton
            label="Requeue All Needs Review"
            description="Runs every needs_review submission back through the full pipeline (re-scrape + re-classify)"
            pending={requeueReview.pending}
            result={requeueReview.result}
            onClick={() => requeueReview.run()}
          />
          <TriggerButton
            label="Check Freshness (All Tools)"
            description="Re-fetches GitHub metadata for every published tool and updates star counts & freshness state"
            pending={freshness.pending}
            result={freshness.result}
            onClick={() => freshness.run()}
          />
          <TriggerButton
            label="Rebuild Search Index"
            description="Runs REINDEX INDEX CONCURRENTLY on the full-text and trigram indexes"
            pending={reindex.pending}
            result={reindex.result}
            onClick={() => reindex.run()}
          />
        </div>
      </section>

      {/* Crawl connectors */}
      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Trigger Crawl</h2>
        <div className="flex flex-wrap gap-3">
          {CONNECTORS.map((c) => (
            <TriggerButton
              key={c.key}
              label={c.label}
              description={c.description}
              pending={crawl.pending && lastCrawlConnector === c.key}
              result={lastCrawlConnector === c.key ? crawl.result : null}
              onClick={() => {
                setLastCrawlConnector(c.key)
                crawl.run(c.key)
              }}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function TriggerButton({
  label,
  description,
  pending,
  result,
  onClick,
}: {
  label: string
  description: string
  pending: boolean
  result: { ok?: boolean; error?: string } | null
  onClick: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Queuing…' : label}
      </button>
      <p className="text-xs text-muted">{description}</p>
      {result?.ok && <p className="text-xs text-official">Queued ✓</p>}
      {result?.error && <p className="text-xs text-frc">Error: {result.error}</p>}
    </div>
  )
}
