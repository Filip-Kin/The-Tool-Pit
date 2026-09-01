'use client'

import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { buttonClass } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import type { ThemePreference } from '@/lib/theme/theme'
import {
  applyPreference,
  getStoredPreference,
  onStoredPreferenceChange,
  paintPreference,
} from '@/lib/theme/theme-dom'

/**
 * Light, dark, or whatever the machine is doing.
 *
 * WHY IT IS HERE, next to the account menu, and not inside it: the profile menu
 * only exists once you are signed in, and most people who read this site never
 * sign in at all. Every vertical header renders this beside <UserMenu />, so the
 * control is in the same place on every page, signed in or not, including the
 * ones a search engine drops you into.
 *
 * The trigger shows the theme you are LOOKING AT rather than the setting you
 * chose, which is the more useful of the two and the only one CSS can draw
 * without JavaScript. Which glyph shows is decided by `html[data-theme]` in
 * globals.css, so it is correct in the first paint and there is nothing for
 * hydration to disagree about. The menu, which does show the setting, cannot be
 * open before the component has mounted, so it can read storage freely.
 */

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export function ThemeToggle({ className }: { className?: string }) {
  // 'system' is both the default and the safe pre-mount answer, so the first
  // client render matches the server's.
  const [preference, setPreference] = useState<ThemePreference>('system')

  useEffect(() => {
    setPreference(getStoredPreference())
    // Another tab changing the setting changes it here too. Two tabs of the
    // same site disagreeing about the theme looks like a bug, because it is.
    return onStoredPreferenceChange((next) => {
      setPreference(next)
      // Paint, do not re-record. The other tab already wrote it, and writing it
      // back would fire the same event straight back at them.
      paintPreference(next)
    })
  }, [])

  function choose(next: string) {
    const value = next as ThemePreference
    setPreference(value)
    applyPreference(value)
  }

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Colour theme"
          className={buttonClass({
            variant: 'ghost',
            size: 'sm',
            className: cn('h-8 w-8 p-0', className),
          })}
        >
          <Sun className="theme-glyph-light h-4 w-4" aria-hidden />
          <Moon className="theme-glyph-dark h-4 w-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        {/* Same shape as the account menu it sits next to: same width floor,
            same border, same offset. Two menus a few pixels apart that do not
            match is exactly the drift the button audit was about. */}
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-40 rounded-md border border-border-subtle bg-background p-1 shadow-xl"
        >
          <DropdownMenu.RadioGroup value={preference} onValueChange={choose}>
            {OPTIONS.map(({ value, label, icon: Icon }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-surface"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                {label}
                {/* The tick sits at the end rather than in Radix's usual left
                    slot, so the three icons stay in one column and the row
                    still reads as icon-then-label. */}
                <DropdownMenu.ItemIndicator className="ml-auto">
                  <Check className="h-4 w-4 text-primary" aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
