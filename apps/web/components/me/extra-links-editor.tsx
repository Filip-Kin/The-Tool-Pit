'use client'

import { useEffect, useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  EXTRA_LINK_LABEL_KEY,
  EXTRA_LINK_LABEL_MAX,
  EXTRA_LINK_URL_KEY,
  EXTRA_LINK_URL_MAX,
  MAX_EXTRA_LINKS,
  type ExtraLink,
} from './listing-fields'

/**
 * The repeatable list of links an owner writes themselves.
 *
 * The seven fixed boxes above it cover the link types the site understands.
 * This covers the ones only the owner knows about: a Discord, a build video, a
 * store page, a second repository. A name and an address, as many as they need.
 *
 * ON THE WIRE. Each row posts two keys, `extraLinkLabel` and `extraLinkUrl`,
 * and BOTH inputs are always rendered even when one is empty. That is what
 * keeps the two arrays index-aligned on the server with no row id to carry, and
 * it is why a row is never conditionally rendered. See parseExtraLinks in
 * listing-fields.ts, which is the only thing that reads them.
 *
 * NO DRAG HANDLE, on purpose. Rows come back in the order they were added,
 * because tool_links has no position column and the writer's whole job is to
 * leave an unchanged row alone. Offering a reorder we would then quietly
 * discard is worse than not offering one.
 *
 * Used by the owner editor, where it is controlled and every change feeds the
 * autosave, and by the admin tool editor through ExtraLinksField below, where
 * the form has a Save button and holds its own state.
 */

/** Where focus goes after the list changes shape under the user's hands. */
type FocusTarget = { kind: 'row'; index: number } | { kind: 'add' } | null

export function ExtraLinksEditor({
  label,
  links,
  onChange,
}: {
  /** Names the group for a screen reader. The rows alone never say what they are. */
  label: string
  links: readonly ExtraLink[]
  onChange: (links: ExtraLink[]) => void
}) {
  const addId = useId()
  const [focus, setFocus] = useState<FocusTarget>(null)

  /**
   * Adding a row and removing one both change what is on screen, and neither
   * leaves focus anywhere sensible on its own: a new row is empty and unfocused,
   * and the button you just pressed to remove a row no longer exists, which
   * drops focus on <body> and starts the next Tab at the top of the page. Run
   * after the render so the element being aimed at is actually there.
   */
  useEffect(() => {
    if (!focus) return
    const selector = focus.kind === 'add' ? `#${CSS.escape(addId)}` : `[data-row="${focus.index}"] input`
    document.querySelector<HTMLElement>(selector)?.focus()
    setFocus(null)
  }, [focus, addId])

  function edit(index: number, patch: Partial<ExtraLink>) {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)))
  }

  function add() {
    onChange([...links, { label: '', url: '' }])
    setFocus({ kind: 'row', index: links.length })
  }

  function remove(index: number) {
    onChange(links.filter((_, i) => i !== index))
    setFocus({ kind: 'add' })
  }

  const full = links.length >= MAX_EXTRA_LINKS

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      {links.map((link, i) => (
        <div
          // Index keys, and they are safe here: every input is fully
          // controlled, so a removed row cannot leave its text behind in the
          // one that takes its place.
          key={i}
          data-row={i}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]"
        >
          <input
            name={EXTRA_LINK_LABEL_KEY}
            value={link.label}
            onChange={(e) => edit(i, { label: e.target.value })}
            maxLength={EXTRA_LINK_LABEL_MAX}
            placeholder="Discord"
            aria-label={`Name for link ${i + 1}`}
            className="input"
          />
          <input
            name={EXTRA_LINK_URL_KEY}
            type="url"
            value={link.url}
            onChange={(e) => edit(i, { url: e.target.value })}
            maxLength={EXTRA_LINK_URL_MAX}
            placeholder="https://"
            aria-label={`Address for link ${i + 1}`}
            className="input col-span-2 sm:col-span-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => remove(i)}
            aria-label={link.label ? `Remove ${link.label}` : `Remove link ${i + 1}`}
            className="row-start-1 self-start px-2 sm:col-start-3"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {full ? (
        <p className="text-xs text-muted-2">
          That is all {MAX_EXTRA_LINKS} links. Take one off to add another.
        </p>
      ) : (
        <Button
          id={addId}
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          className="self-start"
        >
          <Plus className="h-4 w-4" />
          {links.length === 0 ? 'Add a link' : 'Add another'}
        </Button>
      )}
    </div>
  )
}

/**
 * The same editor holding its own rows.
 *
 * For the admin tool editor, which is a plain form with a Save button and no
 * state of its own to hang these on. The owner form uses the controlled
 * component above instead, because every keystroke there has to reach the
 * autosave snapshot.
 */
export function ExtraLinksField({
  label,
  initial,
}: {
  label: string
  initial: readonly ExtraLink[]
}) {
  const [links, setLinks] = useState<ExtraLink[]>(() => initial.map((l) => ({ ...l })))
  return <ExtraLinksEditor label={label} links={links} onChange={setLinks} />
}
