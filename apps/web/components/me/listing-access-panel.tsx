'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { roleLabel } from './listing-labels'
import type { OwnerRow } from '@/lib/queries/listing-ownership'
import type { ListingEntityType, ListingOwnerRole } from '@the-tool-pit/db'

/**
 * Who can manage a listing, and how an owner adds someone.
 *
 * A listing can have any number of owners and editors. An OWNER edits every
 * field and manages who else has access; an EDITOR edits every field but cannot
 * add or remove people. An owner invites someone by typing their EMAIL and
 * choosing a role: the site sends them an invitation, and accepting it makes
 * them an owner or an editor. Only owners see the invite and remove controls;
 * an editor sees the list but nothing to change it.
 */
export function ListingAccessPanel({
  entityType,
  entityId,
  members,
  isOwner,
  currentUserId,
  inviteAction,
  removeAction,
}: {
  entityType: ListingEntityType
  entityId: string
  members: OwnerRow[]
  isOwner: boolean
  /**
   * Whose row not to put a Remove button on.
   *
   * Removing yourself from this list IS leaving the listing, and leaving has
   * its own panel at the bottom of this page, which explains what it costs and
   * asks before it fires. Two buttons for one action on one screen, one of them
   * one click and unlabelled, is exactly what that panel exists to replace.
   */
  currentUserId: string
  inviteAction: (
    entityType: string,
    entityId: string,
    role: string,
    email: string | null,
  ) => Promise<{ error?: string; message?: string; inviteUrl?: string }>
  removeAction: (
    entityType: string,
    entityId: string,
    targetUserId: string,
  ) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [role, setRole] = useState<ListingOwnerRole>('editor')
  const [email, setEmail] = useState('')

  function onInvite() {
    setErr(null)
    setMsg(null)
    setInviteUrl(null)
    start(async () => {
      const res = await inviteAction(entityType, entityId, role, email.trim() || null)
      if (res.error) {
        setErr(res.error)
        return
      }
      setMsg(res.message ?? null)
      setInviteUrl(res.inviteUrl ?? null)
      setEmail('')
      router.refresh()
    })
  }

  function onRemove(userId: string) {
    setErr(null)
    start(async () => {
      const res = await removeAction(entityType, entityId, userId)
      if (res.error) setErr(res.error)
      else router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-5">
      <h2 className="text-lg font-semibold text-foreground">Who can manage this</h2>

      <ul className="mt-4 flex flex-col gap-2">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-2 p-2.5">
            <div className="min-w-0 flex-1">
              <span className="truncate text-sm text-foreground">{m.displayName ?? m.email ?? 'Member'}</span>
            </div>
            <Badge variant="muted">{roleLabel(m.role)}</Badge>
            {m.userId === currentUserId && <Badge variant="muted">You</Badge>}
            {isOwner && m.userId !== currentUserId && (
              <button
                type="button"
                onClick={() => onRemove(m.userId)}
                disabled={pending}
                className="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className="mt-5 border-t border-border-subtle pt-5">
          <h3 className="text-sm font-medium text-foreground">Invite someone</h3>
          <p className="mt-1 text-xs text-muted-2">
            Enter their email and we will send them an invitation. An <strong>editor</strong> can
            change the listing; an <strong>owner</strong> can also add and remove people. Their email
            is only used to reach them and is never shown on the public listing.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1.5 sm:w-36">
              <span className="text-xs font-medium text-muted">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ListingOwnerRole)}
                className="input"
              >
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="them@example.org"
                className="input"
              />
            </label>
            <button
              type="button"
              onClick={onInvite}
              disabled={pending || !email.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              {pending ? 'Sending…' : 'Send invite'}
            </button>
          </div>

          {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}

          {inviteUrl && (
            <div className="mt-3">
              <p className="text-xs text-muted">Send them this link yourself:</p>
              <code className="mt-1 block break-all rounded-md border border-border-subtle bg-surface-2 p-2 text-xs text-foreground">
                {inviteUrl}
              </code>
            </div>
          )}
        </div>
      )}

      {err && (
        <p role="alert" className="mt-3 text-sm text-frc">
          {err}
        </p>
      )}
    </section>
  )
}
