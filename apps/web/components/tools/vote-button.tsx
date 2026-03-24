'use client'

import { useState, useTransition } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface VoteButtonProps {
  toolId: string
  initialCount: number
  initialVoted?: boolean
  className?: string
}

export function VoteButton({ toolId, initialCount, initialVoted = false, className }: VoteButtonProps) {
  const [count, setCount] = useState(initialCount)
  const [voted, setVoted] = useState(initialVoted)
  const [isPending, startTransition] = useTransition()

  async function handleVote() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolId }),
        })
        if (res.ok) {
          const data = await res.json()
          setCount(data.voteCount)
          setVoted(data.voted)
        }
      } catch {
        // Fail silently — voting is non-critical
      }
    })
  }

  return (
    <button
      onClick={handleVote}
      disabled={isPending}
      aria-label={voted ? 'Remove upvote' : 'Upvote this tool'}
      aria-pressed={voted}
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all',
        voted
          ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30'
          : 'bg-[var(--color-surface-3)] text-[var(--color-muted)] border border-transparent hover:border-[var(--color-border)] hover:text-[var(--color-foreground)]',
        isPending && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <ArrowUp className={cn('h-3 w-3', voted && 'text-[var(--color-primary)]')} />
      {count > 0 && <span>{count}</span>}
    </button>
  )
}
