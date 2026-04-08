'use client'

import { Github, ExternalLink, BookOpen, Bug, FileText, Globe } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FreshnessChip } from '@/components/ui/freshness-chip'
import { VoteButton } from '@/components/tools/vote-button'
import { formatRelativeTime } from '@/lib/utils/time'
import { cn } from '@/lib/utils/cn'
import type { ToolDetailData } from '@/lib/queries/tools'

const PROGRAM_LABELS: Record<string, string> = { frc: 'FRC', ftc: 'FTC', fll: 'FLL' }
const ROLE_LABELS: Record<string, string> = {
  student: 'Student', mentor: 'Mentor', volunteer: 'Volunteer',
  parent_newcomer: 'Parent / Newcomer', organizer_staff: 'Organizer / Staff',
}
const FUNCTION_LABELS: Record<string, string> = {
  programmer: 'Programmer', scouter: 'Scouter', strategist: 'Strategist',
  cad: 'CAD', mechanical: 'Mechanical', electrical: 'Electrical',
  drive_team: 'Drive Team', awards: 'Awards', outreach: 'Outreach',
  team_management: 'Team Management', event_ops: 'Event Ops',
  field_technical: 'Field Technical', inspection: 'Inspection', judging: 'Judging',
}

const LINK_CONFIG: Record<string, { icon: React.ElementType; label: string; prominent?: boolean }> = {
  github: { icon: Github, label: 'GitHub', prominent: true },
  homepage: { icon: Globe, label: 'Homepage', prominent: true },
  docs: { icon: BookOpen, label: 'Documentation' },
  issues: { icon: Bug, label: 'Issue Tracker' },
  changelog: { icon: FileText, label: 'Changelog' },
  other: { icon: ExternalLink, label: 'Link' },
  source: { icon: ExternalLink, label: 'Source' },
}

interface ToolDetailProps {
  tool: ToolDetailData
}

export function ToolDetail({ tool }: ToolDetailProps) {
  const githubLink = tool.links.find((l) => l.linkType === 'github')
  const prominentLinks = tool.links.filter(
    (l) => (l.linkType === 'github' || l.linkType === 'homepage') && !l.isBroken,
  )
  const otherLinks = tool.links.filter(
    (l) => l.linkType !== 'github' && l.linkType !== 'homepage' && !l.isBroken,
  )

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_280px]">
        {/* Main content */}
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {tool.programs.map((p) => (
                <Badge key={p} variant="program">{PROGRAM_LABELS[p] ?? p.toUpperCase()}</Badge>
              ))}
              {tool.isOfficial && <Badge variant="official">FIRST Official</Badge>}
              {tool.isVendor && <Badge variant="vendor">Vendor{tool.vendorName ? ` · ${tool.vendorName}` : ''}</Badge>}
              {tool.isRookieFriendly && <Badge variant="rookie">Rookie Friendly</Badge>}
              {tool.isTeamCode && (
                <Badge variant="team">{tool.teamNumber ? `Team ${tool.teamNumber}` : 'Team Robot Code'}</Badge>
              )}
              {tool.isTeamCode && tool.seasonYear && (
                <Badge variant="season">{tool.seasonYear} Season</Badge>
              )}
            </div>

            <h1 className="text-3xl font-bold text-foreground">{tool.name}</h1>

            {tool.summary && (
              <p className="text-lg text-muted leading-relaxed">{tool.summary}</p>
            )}

            <div className="flex items-center gap-4 flex-wrap">
              <FreshnessChip
                freshnessState={tool.freshnessState}
                lastActivityAt={tool.lastActivityAt}
              />
              {tool.lastActivityAt && (
                <span className="text-sm text-muted-2">
                  Updated {formatRelativeTime(tool.lastActivityAt)}
                </span>
              )}
              <VoteButton toolId={tool.id} initialCount={tool.voteCount} />
            </div>
          </div>

          {/* Prominent links (GitHub + Homepage) */}
          {prominentLinks.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {prominentLinks.map((link) => {
                const cfg = LINK_CONFIG[link.linkType] ?? LINK_CONFIG.other
                const Icon = cfg.icon
                const isGithub = link.linkType === 'github'
                return (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackClick(tool.id, link.linkType)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                      isGithub
                        ? 'border-border bg-surface-2 text-foreground hover:bg-surface-3'
                        : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {link.label ?? cfg.label}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </a>
                )
              })}
            </div>
          )}

          {/* Description */}
          {tool.description && (
            <div className="prose prose-invert max-w-none text-muted">
              <p className="whitespace-pre-wrap leading-relaxed">{tool.description}</p>
            </div>
          )}

          {/* Other links */}
          {otherLinks.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted">More links</h3>
              <div className="flex flex-wrap gap-2">
                {otherLinks.map((link) => {
                  const cfg = LINK_CONFIG[link.linkType] ?? LINK_CONFIG.other
                  const Icon = cfg.icon
                  return (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackClick(tool.id, link.linkType)}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {link.label ?? cfg.label}
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-6">
          <div className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-4">
            <MetaRow label="Type" value={formatToolType(tool.toolType)} />
            {tool.audienceRoles.length > 0 && (
              <MetaTagRow label="Audience" tags={tool.audienceRoles.map((r) => ROLE_LABELS[r] ?? r)} />
            )}
            {tool.audienceFunctions.length > 0 && (
              <MetaTagRow label="Roles" tags={tool.audienceFunctions.map((f) => FUNCTION_LABELS[f] ?? f)} />
            )}
            {tool.teamNumber && <MetaRow label="Team" value={`#${tool.teamNumber}`} />}
            {tool.seasonYear && <MetaRow label="Season" value={String(tool.seasonYear)} />}
            {tool.isTeamCode && tool.teamNumber && (
              <a href={`/robot-code?team=${tool.teamNumber}`} className="text-xs text-primary hover:underline">
                More from this team ↗
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-2">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  )
}

function MetaTagRow({ label, tags }: { label: string; tags: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-2">{label}</span>
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

function formatToolType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function trackClick(toolId: string, linkType: string) {
  fetch('/api/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, linkType }),
  }).catch(() => {})
}
