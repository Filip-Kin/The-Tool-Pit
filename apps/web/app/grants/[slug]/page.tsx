import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarClock, Coins, ExternalLink, Gauge, Globe2, RefreshCw, ShieldCheck } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { getGrantApplyContext, getGrantBySlug, isGrantFavorited, isGrantWatched } from '@/lib/queries/grants'
import { listProfilesForUser } from '@/app/me/team/profile/queries'
import { buildPrefillUrl } from '@/lib/grants/prefill'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getVerticalLinks } from '@/components/layout/vertical-switcher'
import { ApplyPanel } from '@/components/grants/apply-panel'
import { GrantCycles } from '@/components/grants/grant-cycles'
import { GrantRequirements } from '@/components/grants/grant-requirements'
import { SaveGrantButton } from '@/components/grants/save-grant-button'
import {
  DEADLINE_STATE_LABEL,
  DEADLINE_TYPE_LABEL,
  EFFORT_LABEL,
  FUNDER_TYPE_LABEL,
  PROGRAM_LABEL,
  expectedNextWindow,
  formatAwardRange,
  formatCountdown,
  formatDay,
  formatDeadline,
  geographyLabel,
  resolveNextCycle,
} from '@/lib/grants/grant-display'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const grant = await getGrantBySlug(slug)
  if (!grant) return { title: 'Grant not found' }
  return {
    title: grant.name,
    description: grant.summary ?? undefined,
  }
}

export default async function GrantDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const grant = await getGrantBySlug(slug)
  if (!grant) notFound()

  const now = new Date()
  const resolved = resolveNextCycle(grant, now)
  const user = await getCurrentUser()

  const [favorited, watching, applyContext] = await Promise.all([
    user ? isGrantFavorited(user.id, grant.id) : Promise.resolve(false),
    user ? isGrantWatched(user.id, grant.id) : Promise.resolve(false),
    getGrantApplyContext(grant.id),
  ])

  // The apply panel fills the funder's own form from the team's saved answers.
  // The profile is read here, on the server, and only the finished prefill is
  // sent to the browser: the EIN and contact details never travel as props.
  //
  // A mentor can belong to more than one team profile, and the panel has no
  // team switcher yet, so the first one is used and the page says which. Saying
  // it is the difference between a limitation and a wrong application.
  const profiles = user ? await listProfilesForUser(user.id) : []
  const profile = profiles[0]?.profile ?? null
  const prefill = profile ? buildPrefillUrl(grant, applyContext.formFields, profile) : null
  const profileHref = await teamProfileHref()

  const award = formatAwardRange(grant)
  const deadline = formatDeadline(resolved.cycle?.deadlineAt ?? null)
  const countdown = formatCountdown(resolved.daysRemaining)
  const nextWindow = resolved.state === 'closed' ? expectedNextWindow(grant, now) : null
  const verified = formatDay(grant.verifiedAt)

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← All grants
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {grant.programs.map((p) => (
                <span key={p} className="rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-muted">
                  {PROGRAM_LABEL[p]}
                </span>
              ))}
            </div>
            <h1 className="text-2xl font-bold text-foreground">{grant.name}</h1>
            {grant.funder && (
              <p className="text-sm text-muted">
                {grant.funder.website ? (
                  <a
                    href={grant.funder.website}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {grant.funder.name}
                  </a>
                ) : (
                  grant.funder.name
                )}
                <span className="text-muted-2"> · {FUNDER_TYPE_LABEL[grant.funder.type]}</span>
              </p>
            )}
            {grant.summary && <p className="text-sm text-muted">{grant.summary}</p>}
          </header>

          {grant.description && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">About this grant</h2>
              <p className="whitespace-pre-wrap text-sm text-foreground">{grant.description}</p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Who can apply</h2>
            <GrantRequirements requirements={grant.requirements} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Application windows</h2>
            <p className="text-xs text-muted-2">
              Past rounds are kept so you can see the pattern. A grant that closed in March usually opens again
              around the same time.
            </p>
            <GrantCycles cycles={grant.cycles} now={now} />
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          {/*
            The verified line sits above everything else on purpose. It is the
            one fact that tells a team how much to trust the dates below it, and
            burying it would be the same as not saying it.
          */}
          <Card pad="sm" className="flex items-start gap-2 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-rookie" aria-hidden />
            {verified ? (
              <span className="text-foreground">
                Verified against the funder&apos;s own page on{' '}
                <span className="font-semibold">{verified}</span>
              </span>
            ) : (
              <span className="text-muted">
                Not yet confirmed by a person. Check the funder&apos;s page before you rely on anything here.
              </span>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <Fact icon={<CalendarClock className="h-4 w-4" />} label="Deadline">
              <span className="text-foreground">{DEADLINE_STATE_LABEL[resolved.state]}</span>
              {deadline && (
                <span className="block text-muted">
                  {resolved.isEstimated ? `${deadline} (expected)` : deadline}
                  {resolved.state === 'open' && countdown ? ` · ${countdown}` : ''}
                </span>
              )}
              {nextWindow && <span className="block text-muted-2">Expected back {nextWindow}</span>}
              <span className="block text-muted-2">{DEADLINE_TYPE_LABEL[grant.deadlineType]}</span>
            </Fact>

            <Fact icon={<Coins className="h-4 w-4" />} label="Award">
              <span className="text-foreground">{award ?? 'Amount not confirmed'}</span>
              {grant.awardNotes && <span className="block text-muted">{grant.awardNotes}</span>}
            </Fact>

            <Fact icon={<Globe2 className="h-4 w-4" />} label="Geography">
              <span className="text-foreground">{geographyLabel(grant)}</span>
            </Fact>

            <Fact icon={<Gauge className="h-4 w-4" />} label="Effort">
              <span className="text-foreground">{EFFORT_LABEL[grant.effortLevel]}</span>
            </Fact>

            {grant.renewable !== null && (
              <Fact icon={<RefreshCw className="h-4 w-4" />} label="Renewable">
                <span className="text-foreground">
                  {grant.renewable ? 'You can apply again in a later round' : 'One award per team'}
                </span>
              </Fact>
            )}
          </Card>

          <div className="flex flex-col gap-3">
            <ButtonLink href={grant.infoUrl} external variant="secondary">
              Read the funder&apos;s page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </ButtonLink>

            <SaveGrantButton
              grantId={grant.id}
              initialSaved={favorited}
              initialWatching={watching}
              hasDeadline={resolved.cycle?.deadlineAt != null && !resolved.isEstimated}
            />
          </div>

          <ApplyPanel
            grantName={grant.name}
            applicationUrl={grant.applicationUrl ?? grant.infoUrl}
            mappedFieldCount={applyContext.formFields.length}
            prefillableFieldCount={applyContext.formFields.filter((f) => f.fillKind !== 'copy').length}
            prefill={prefill}
            hasProfile={!!profile}
            profileHref={profileHref}
          />

          {profile && profiles.length > 1 && (
            <p className="text-xs text-muted-2">
              Answers above come from team {profile.teamNumber}
              {profile.teamName ? ` (${profile.teamName})` : ''}. You are on {profiles.length} team profiles;
              picking which one to apply as is not built yet.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}

/**
 * Absolute link to the team screen, which is where the profile editor lives.
 *
 * /me lives on the tools host, and this page is served from grants.*, so a
 * relative "/me/team" would be rewritten into the grants route tree and 404.
 * getVerticalLinks() already works the hosts out from the request, which also
 * keeps this correct on frc.tools and on a dev box with no subdomains.
 */
async function teamProfileHref(): Promise<string> {
  const links = await getVerticalLinks('grants')
  const tools = links.find((l) => l.key === 'tools')?.href ?? '/'
  return `${tools.replace(/\/$/, '')}/me/team`
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-muted-2" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-2">{label}</div>
        {children}
      </div>
    </div>
  )
}
