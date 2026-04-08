'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition, useRef, useState, useEffect, useCallback, useId } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import Link from 'next/link'

interface SearchBarProps {
  defaultValue?: string
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  autoFocus?: boolean
  className?: string
  /** When set, appends program=<value> to the search URL if not already present. */
  defaultProgram?: string
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

interface Suggestion {
  name: string
  slug: string
  summary: string | null
}

export function SearchBar({
  defaultValue = '',
  placeholder = 'Search…',
  size = 'md',
  autoFocus,
  className,
  defaultProgram,
}: SearchBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(defaultValue)
  const [isPending, startTransition] = useTransition()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listboxId = useId()

  // Sync when defaultValue changes (e.g. navigating)
  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    try {
      const params = new URLSearchParams({ q: q.trim() })
      if (defaultProgram) params.set('program', defaultProgram)
      const res = await fetch(`/api/search/suggestions?${params}`)
      if (!res.ok) return
      const data = await res.json() as Suggestion[]
      setSuggestions(data)
      setShowSuggestions(data.length > 0)
      setActiveIndex(-1)
    } catch {
      // ignore
    }
  }, [defaultProgram])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setValue(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void fetchSuggestions(v) }, 300)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q) return
    setShowSuggestions(false)
    setActiveIndex(-1)

    const params = new URLSearchParams(searchParams.toString())
    params.set('q', q)
    params.delete('page')

    if (defaultProgram && !params.has('program')) {
      params.set('program', defaultProgram)
    }

    startTransition(() => {
      router.push(`/search?${params.toString()}`)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setActiveIndex(-1)
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      const s = suggestions[activeIndex]
      if (s) {
        setShowSuggestions(false)
        router.push(`/tools/${s.slug}`)
      }
    }
  }

  function handleClear() {
    setValue('')
    setSuggestions([])
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <form action="/search" onSubmit={handleSubmit}>
        {/* Hidden inputs ensure the program filter survives native form submission
            (before React hydrates or when JS is unavailable). */}
        {defaultProgram && <input type="hidden" name="program" value={defaultProgram} />}
        <Search
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-2',
            iconSizeClasses[size],
          )}
        />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showSuggestions}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
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

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg overflow-hidden"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.slug}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              <Link
                href={`/tools/${s.slug}`}
                onClick={() => setShowSuggestions(false)}
                className={cn(
                  'flex flex-col gap-0.5 px-4 py-2.5 text-sm transition-colors',
                  i === activeIndex
                    ? 'bg-primary/10 text-foreground'
                    : 'hover:bg-surface-2 text-foreground',
                )}
              >
                <span className="font-medium">{s.name}</span>
                {s.summary && (
                  <span className="text-xs text-muted line-clamp-1">{s.summary}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

