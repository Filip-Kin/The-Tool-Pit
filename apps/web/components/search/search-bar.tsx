'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition, useRef, useState, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface SearchBarProps {
  defaultValue?: string
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  autoFocus?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'h-8 text-sm pl-8 pr-3',
  md: 'h-10 text-sm pl-10 pr-4',
  lg: 'h-12 text-base pl-12 pr-4',
}

const iconSizeClasses = {
  sm: 'h-3.5 w-3.5 left-2.5',
  md: 'h-4 w-4 left-3',
  lg: 'h-5 w-5 left-3.5',
}

export function SearchBar({
  defaultValue = '',
  placeholder = 'Search…',
  size = 'md',
  autoFocus,
  className,
}: SearchBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(defaultValue)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync when defaultValue changes (e.g. navigating)
  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q) return

    // Preserve existing program filter if on a program page
    const params = new URLSearchParams(searchParams.toString())
    params.set('q', q)
    params.delete('page')

    startTransition(() => {
      router.push(`/search?${params.toString()}`)
    })
  }

  function handleClear() {
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={handleSubmit} className={cn('relative', className)}>
      <Search
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-2',
          iconSizeClasses[size],
        )}
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn(
          'w-full rounded-lg border border-border bg-surface text-foreground placeholder:text-muted-2 outline-none transition-colors',
          'focus:border-primary focus:ring-2 focus:ring-primary/20',
          isPending && 'opacity-70',
          sizeClasses[size],
        )}
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-2 hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  )
}
