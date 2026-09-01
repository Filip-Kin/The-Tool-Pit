'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, Info, PencilLine, UserPlus } from 'lucide-react'
import { Button, ButtonLink, buttonClass } from '@/components/ui/button'
import { cardClass } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'
import { SignInDialog } from '@/components/auth/sign-in-dialog'
import { useSession } from '@/components/auth/session-provider'
import type { CopyReason, PrefillCopyField, PrefillResult } from '@/lib/grants/prefill'

/**
 * The apply panel on a grant detail page.
 *
 * The whole feature is one honest sentence: we can put a team's answers into
 * the funder's own link, and where the funder's form does not take parameters
 * we can hand the answers over to copy. Nothing is submitted on anyone's
 * behalf and nothing leaves this site until the team presses the funder's own
 * submit button, so the copy here never says "autofilled" when what actually
 * happens is "typed by you, from a list".
 *
 * The prefill itself is built on the SERVER (see lib/grants/prefill.ts) against
 * the signed-in user's own team profile, and only the finished result is sent
 * down. Contact details and the EIN never travel to anyone else's browser.
 */

/** Why an answer has to be pasted rather than carried in the link, in plain words. */
const COPY_REASON_TEXT: Record<CopyReason, string> = {
  not_prefillable: 'this form takes no link parameter for this question',
  no_param_name: 'nobody has mapped the parameter for this question yet',
  too_long: 'too long to travel in a web address',
  no_form_url: 'we do not have an application link for this grant yet',
}

export interface ApplyPanelProps {
  grantName: string
  /**
   * Where the funder takes applications, already falling back to the info page
   * if there is no separate application URL. Null when the grant has neither.
   */
  applicationUrl: string | null
  /** How many questions of the funder's form an admin has mapped. */
  mappedFieldCount: number
  /** How many of those the funder's form can accept from a link. */
  prefillableFieldCount: number
  /**
   * Server-built prefill for the signed-in user's team. Null when signed out,
   * or signed in with no team profile.
   */
  prefill: PrefillResult | null
  /** True when the signed-in user has a team profile we could read. */
  hasProfile: boolean
  /** Where the profile editor lives. */
  profileHref?: string
}

export function ApplyPanel({
  grantName,
  applicationUrl,
  mappedFieldCount,
  prefillableFieldCount,
  prefill,
  hasProfile,
  profileHref = '/grants/profile',
}: ApplyPanelProps) {
  const { user, loading } = useSession()
  const [signInOpen, setSignInOpen] = useState(false)

  const signedIn = !!user

  return (
    <section className={cardClass()}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Apply</h2>

      {!signedIn && !loading && (
        <SignedOutState
          applicationUrl={applicationUrl}
          mappedFieldCount={mappedFieldCount}
          prefillableFieldCount={prefillableFieldCount}
          onSignIn={() => setSignInOpen(true)}
        />
      )}

      {signedIn && !hasProfile && (
        <NoProfileState
          applicationUrl={applicationUrl}
          mappedFieldCount={mappedFieldCount}
          prefillableFieldCount={prefillableFieldCount}
          profileHref={profileHref}
        />
      )}

      {signedIn && hasProfile && prefill && (
        <ReadyState
          grantName={grantName}
          prefill={prefill}
          mappedFieldCount={mappedFieldCount}
          profileHref={profileHref}
        />
      )}

      <SignInDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        reason="Sign in to carry your team profile into this application."
      />
    </section>
  )
}

// #region states

function SignedOutState({
  applicationUrl,
  mappedFieldCount,
  prefillableFieldCount,
  onSignIn,
}: {
  applicationUrl: string | null
  mappedFieldCount: number
  prefillableFieldCount: number
  onSignIn: () => void
}) {
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{offerText(mappedFieldCount, prefillableFieldCount)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onSignIn}>
          <UserPlus className="h-4 w-4" />
          Sign in to prepare this
        </Button>
        <OpenPlainLink url={applicationUrl} />
      </div>
    </div>
  )
}

function NoProfileState({
  applicationUrl,
  mappedFieldCount,
  prefillableFieldCount,
  profileHref,
}: {
  applicationUrl: string | null
  mappedFieldCount: number
  prefillableFieldCount: number
  profileHref: string
}) {
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">
        You have no team profile yet. It is the set of answers every grant asks for, filled in once:
        team number, legal entity, address, contact, and your reusable paragraphs.{' '}
        {offerText(mappedFieldCount, prefillableFieldCount)}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href={profileHref}>
          <PencilLine className="h-4 w-4" />
          Set up a team profile
        </ButtonLink>
        <OpenPlainLink url={applicationUrl} />
      </div>
    </div>
  )
}

function ReadyState({
  grantName,
  prefill,
  mappedFieldCount,
  profileHref,
}: {
  grantName: string
  prefill: PrefillResult
  mappedFieldCount: number
  profileHref: string
}) {
  const filled = prefill.filledFields.length
  const copyCount = prefill.copyFields.length

  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{readyText(prefill, mappedFieldCount)}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {prefill.url ? (
          <ButtonLink href={prefill.url} external>
            <ExternalLink className="h-4 w-4" />
            {filled > 0 ? 'Start application (pre-filled)' : 'Open the application'}
          </ButtonLink>
        ) : (
          <span className="text-sm text-muted-2">
            We have no application link for {grantName} yet. Check the funder’s page above.
          </span>
        )}
      </div>

      {filled > 0 && (
        <p className="mt-2 text-xs text-muted-2">
          The link opens the funder’s own form with your answers already in the boxes. Check every one
          before you submit: we fill it in, you send it.
        </p>
      )}

      {copyCount > 0 && <CopyPack fields={prefill.copyFields} />}

      {prefill.missingFields.length > 0 && (
        <div className="mt-4 rounded-md border border-border-subtle bg-surface-2 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Info className="h-4 w-4 text-official" />
            {prefill.missingFields.length} question
            {prefill.missingFields.length === 1 ? '' : 's'} your profile cannot answer yet
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
            {prefill.missingFields.map((m) => (
              <li key={m.formFieldId}>
                <span className="text-foreground">{m.label}</span>
                <span className="text-muted-2"> · needs {m.pathLabel}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-2">
            We left these out rather than sending blanks, because a blank looks like a deliberate
            answer to the funder.
          </p>
          <a
            href={profileHref}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover"
          >
            <PencilLine className="h-3.5 w-3.5" />
            Fill these in on your team profile
          </a>
        </div>
      )}
    </div>
  )
}

// #endregion

// #region copy pack

function CopyPack({ fields }: { fields: PrefillCopyField[] }) {
  // One block for the lot, for anyone who would rather paste into a scratch
  // document and work down it than click twenty times.
  const allText = useMemo(
    () => fields.map((f) => `${f.label}\n${f.value}`).join('\n\n'),
    [fields],
  )

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {fields.length} answer{fields.length === 1 ? '' : 's'} to paste in yourself
        </h3>
        <CopyButton text={allText} label="Copy all" />
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {fields.map((f) => (
          <li key={f.formFieldId} className="rounded-md border border-border-subtle bg-surface-2 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{f.label}</div>
                <div className="text-xs text-muted-2">{COPY_REASON_TEXT[f.reason]}</div>
              </div>
              <CopyButton text={f.value} label="Copy" />
            </div>
            {/* whitespace-pre-wrap: boilerplate paragraphs keep their line
                breaks, and what is shown is exactly what gets copied. */}
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{f.value}</p>
            {f.notes && <p className="mt-1 text-xs text-muted-2">{f.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const ok = await writeClipboard(text)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      // sm, not md: two of these sit on one row inside a list of answers.
      className={buttonClass({
        variant: 'none',
        size: 'sm',
        className: cn('border border-border', copied ? 'text-rookie' : 'text-muted hover:text-foreground'),
      })}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

/**
 * navigator.clipboard needs a secure context and is missing or blocked in a
 * few browsers people actually use (older iOS Safari in particular). The
 * hidden-textarea path is the old execCommand trick, kept because losing the
 * copy button is losing the whole feature on the copy-only grants.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

// #endregion

// #region copy writing

function OpenPlainLink({ url }: { url: string | null }) {
  if (!url) return null
  return (
    <ButtonLink href={url} external variant="secondary">
      <ExternalLink className="h-4 w-4" />
      Open the application
    </ButtonLink>
  )
}

/**
 * What a profile would actually buy this visitor. Concrete numbers, and no
 * promise of prefill on a form that cannot take it: a funder portal that reads
 * no parameters gets told plainly that the answers come as a copy list.
 */
function offerText(mappedFieldCount: number, prefillableFieldCount: number): string {
  if (mappedFieldCount === 0) {
    return 'Nobody has mapped this funder’s form yet, so there is nothing for us to fill in. Fill in a team profile anyway and the grants that are mapped will be ready to go.'
  }
  if (prefillableFieldCount === 0) {
    return `This funder’s form takes no pre-filled link, so this one has to be typed. With a team profile we can at least lay out all ${mappedFieldCount} answers next to the questions, ready to copy.`
  }
  return `This form has ${mappedFieldCount} question${mappedFieldCount === 1 ? '' : 's'} we know about. With a team profile, ${prefillableFieldCount} of them can be filled in for you before the page even opens.`
}

/** The line above the button once we have a real result for this team. */
function readyText(prefill: PrefillResult, mappedFieldCount: number): string {
  const filled = prefill.filledFields.length
  const copyCount = prefill.copyFields.length

  if (mappedFieldCount === 0) {
    return 'Nobody has mapped this funder’s form yet, so we cannot prepare anything for it. The application link below is the plain one.'
  }
  if (filled === 0 && copyCount === 0) {
    return 'Your profile does not yet answer any of the questions we know about on this form.'
  }
  if (filled === 0) {
    return `This funder’s form cannot be pre-filled from a link, so the application has to be typed. Your ${copyCount} answer${copyCount === 1 ? ' is' : 's are'} below, ready to copy.`
  }
  const tail =
    copyCount > 0
      ? ` The other ${copyCount} cannot travel in a link, so ${copyCount === 1 ? 'it is' : 'they are'} below to copy.`
      : ''
  return `${filled} of ${mappedFieldCount} question${mappedFieldCount === 1 ? '' : 's'} will be filled in when you open the form.${tail}`
}

// #endregion
