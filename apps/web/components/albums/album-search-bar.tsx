'use client'

import { useRouter } from 'next/navigation'
import { useTransition, useRef, useState, useEffect, useCallback, useId } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import Link from 'next/link'

interface AlbumSearchBarProps {
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

interface EventSuggestion {
  tbaKey: string
  eventCode: string
  name: string
  year: number
  /** If the event has exactly one album, its URL - link straight there. */
  soleAlbumUrl: string | null
}

/** A bare team number like "254" or "frc254". */
const TEAM_QUERY_RE = /^(?:frc\s*)?(\d{1,5})$/i

export function AlbumSearchBar({
  defaultValue = '',
  placeholder = 'Search events by name or code, or a team number…',
  size = 'md',
  autoFocus,
  className,
}: AlbumSearchBarProps) {
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)
  const [isPending, startTransition] = useTransition()
  const [suggestions, setSuggestions] = useState<EventSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listboxId = useId()

  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

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
    if (!q.trim() || q.trim().length < 2 || TEAM_QUERY_RE.test(q.trim())) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    try {
      const res = await fetch(`/api/albums/suggestions?q=${encodeURIComponent(q.trim())}`)
      if (!res.ok) return
      const data = (await res.json()) as EventSuggestion[]
      setSuggestions(data)
      setShowSuggestions(data.length > 0)
      setActiveIndex(-1)
    } catch {
      // ignore
    }
  }, [])

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

    const team = q.match(TEAM_QUERY_RE)
    startTransition(() => {
      if (team) router.push(`/photos/team/${parseInt(team[1], 10)}`)
      else router.push(`/photos/search?q=${encodeURIComponent(q)}`)
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
        // One-album events go straight to the album; others to the event page.
        if (s.soleAlbumUrl) window.open(s.soleAlbumUrl, '_blank', 'noopener,noreferrer')
        else router.push(`/photos/event/${s.tbaKey}`)
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
      <form onSubmit={handleSubmit}>
        <Search
          className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-2', iconSizeClasses[size])}
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

      {showSuggestions && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Event suggestions"
          className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg overflow-hidden"
        >
          {suggestions.map((s, i) => (
            <li key={s.tbaKey} id={`${listboxId}-option-${i}`} role="option" aria-selected={i === activeIndex}>
              <Link
                href={s.soleAlbumUrl ?? `/photos/event/${s.tbaKey}`}
                {...(s.soleAlbumUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                onClick={() => setShowSuggestions(false)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm transition-colors',
                  i === activeIndex ? 'bg-primary/10 text-foreground' : 'hover:bg-surface-2 text-foreground',
                )}
              >
                <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                  {s.year}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-2">{s.eventCode}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
