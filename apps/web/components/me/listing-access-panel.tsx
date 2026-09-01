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
 * The invite is the answer to "there is no verification of who is on a team":
 * instead of trusting a stranger's claim, an existing owner sends a single-use
 * link to the person themselves. Only owners see the invite controls; an editor
 * can change the listing but not widen who can.
 */
export function ListingAccessPanel({
  entityType,
  entityId,
  members,
  isOwner,
  createInviteAction,
  removeAction,
}: {
  entityType: ListingEntityType
  entityId: string
  members: OwnerRow[]
  isOwner: boolean
  createInviteAction: (
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
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [role, setRole] = useState<ListingOwnerRole>('editor')
  const [email, setEmail] = useState('')

  function onInvite() {
    setErr(null)
    setInviteUrl(null)
    start(async () => {
      const res = await createInviteAction(entityType, entityId, role, email.trim() || null)
      if (res.error) setErr(res.error)
      else setInviteUrl(res.inviteUrl ?? null)
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
            {isOwner && (
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
            Creates a single-use link that works once and expires in 14 days. Pin it to an email to
            make a leaked link useless to anyone else.
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
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">Email (optional)</span>
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
              disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              {pending ? 'Creating…' : 'Create link'}
            </button>
          </div>

          {inviteUrl && (
            <div className="mt-3">
              <p className="text-xs text-muted">Copy this and send it to the person yourself:</p>
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
