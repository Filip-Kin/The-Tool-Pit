import { describe, it, expect } from 'vitest'
import {
  EXTRA_LINK_LABEL_KEY,
  EXTRA_LINK_LABEL_MAX,
  EXTRA_LINK_URL_KEY,
  EXTRA_LINKS_KEY,
  LISTING_FORMS,
  MAX_EXTRA_LINKS,
  parseExtraLinks,
  parseListingValues,
  listingFormSpec,
  type ExtraLink,
} from '@/components/me/listing-fields'
import { planExtraLinkWrite, planIsNoop } from '@/lib/listings/extra-link-plan'

/**
 * The links an owner writes themselves: what is accepted, and what is touched.
 *
 * Two rules, in two places, and both of them are invisible to the type checker.
 *
 * WHAT IS ACCEPTED is parseExtraLinks. A posted form is strings, and every
 * string here becomes the href of a link somebody clicks, so the scheme, the
 * lengths and the cap are all checked server-side however tidy the editor is.
 *
 * WHAT IS TOUCHED is planExtraLinkWrite. The owner form autosaves on every
 * blur, so it posts constantly, and re-writing the whole list each time would
 * reset is_broken and last_checked_at on links nobody edited. Those two columns
 * are the link checker's memory of where it has already been, so an unchanged
 * row has to come out of the planner as untouched, not as a delete plus an
 * identical insert.
 *
 * Neither module imports the db package, which is why they can be tested at
 * all: the barrel re-exports the postgres client and needs a connection string
 * to load. lib/listings/tool-links.ts holds the queries and nothing else.
 */

// #region helpers

/** A posted form with one pair of keys repeated per row, the way the editor posts. */
function postRows(rows: readonly (readonly [string, string])[]): FormData {
  const fd = new FormData()
  for (const [label, url] of rows) {
    fd.append(EXTRA_LINK_LABEL_KEY, label)
    fd.append(EXTRA_LINK_URL_KEY, url)
  }
  return fd
}

function links(form: FormData): ExtraLink[] {
  const parsed = parseExtraLinks(form)
  if ('error' in parsed) throw new Error(`expected links, got: ${parsed.error}`)
  return parsed.links
}

function stored(...rows: readonly (readonly [string, string, string])[]) {
  return rows.map(([id, label, url]) => ({ id, label: label === '' ? null : label, url }))
}

// #endregion

describe('what a posted list is allowed to contain', () => {
  it('takes a name and an address per row, in the order they were posted', () => {
    expect(
      links(
        postRows([
          ['Discord', 'https://discord.gg/abc'],
          ['Build video', 'https://youtube.com/watch?v=1'],
        ]),
      ),
    ).toEqual([
      { label: 'Discord', url: 'https://discord.gg/abc' },
      { label: 'Build video', url: 'https://youtube.com/watch?v=1' },
    ])
  })

  it('ignores an empty row, because pressing Add makes one', () => {
    // The form has no Save button. Adding a row and then blurring anything
    // posts the whole form, so an untouched new row MUST store nothing at all
    // rather than an empty link.
    expect(links(postRows([['', ''], ['Discord', 'https://discord.gg/abc'], ['', '']]))).toEqual([
      { label: 'Discord', url: 'https://discord.gg/abc' },
    ])
  })

  it('ignores a row with a name and no address yet, and does not lose the rest', () => {
    // Half-typed. It stays on screen in the editor's own state; there is just
    // nothing to store for it.
    expect(links(postRows([['Store page', ''], ['Docs', 'https://example.com/docs']]))).toEqual([
      { label: 'Docs', url: 'https://example.com/docs' },
    ])
  })

  it('keeps a row that has an address but no name', () => {
    // The detail page falls back to the generic word for the link type, so this
    // is a usable link rather than an error to argue with someone about.
    expect(links(postRows([['', 'https://example.com']]))).toEqual([
      { label: '', url: 'https://example.com' },
    ])
  })

  it('trims both halves', () => {
    expect(links(postRows([['  Discord  ', '  https://discord.gg/abc  ']]))).toEqual([
      { label: 'Discord', url: 'https://discord.gg/abc' },
    ])
  })

  it('refuses an address that is not http or https', () => {
    // Every one of these ends up as an href. A javascript: URL passes new URL()
    // and would run on click, so the scheme is checked here and not left to
    // whatever renders it.
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'example.com']) {
      const parsed = parseExtraLinks(postRows([['Discord', bad]]))
      expect('error' in parsed, bad).toBe(true)
    }
  })

  it('names the offending row in the error, when the owner named it', () => {
    const parsed = parseExtraLinks(postRows([['Discord', 'not a url']]))
    expect('error' in parsed && parsed.error).toContain('Discord')
  })

  it('refuses more than the cap, and says how to get under it', () => {
    const under = postRows(
      Array.from({ length: MAX_EXTRA_LINKS }, (_, i) => [`Link ${i}`, `https://example.com/${i}`] as const),
    )
    expect(links(under)).toHaveLength(MAX_EXTRA_LINKS)

    const over = postRows(
      Array.from({ length: MAX_EXTRA_LINKS + 1 }, (_, i) => [`Link ${i}`, `https://example.com/${i}`] as const),
    )
    const parsed = parseExtraLinks(over)
    expect('error' in parsed).toBe(true)
    expect('error' in parsed && parsed.error).toContain(String(MAX_EXTRA_LINKS))
  })

  it('counts empty rows against nothing, so a page of blanks is not over the cap', () => {
    const rows: (readonly [string, string])[] = Array.from({ length: 40 }, () => ['', ''] as const)
    rows.push(['Discord', 'https://discord.gg/abc'])
    expect(links(postRows(rows))).toHaveLength(1)
  })

  it('truncates a very long name rather than refusing the link', () => {
    const long = 'x'.repeat(EXTRA_LINK_LABEL_MAX + 50)
    expect(links(postRows([[long, 'https://example.com']]))[0].label).toHaveLength(EXTRA_LINK_LABEL_MAX)
  })

  it('drops a row that repeats an earlier one exactly', () => {
    // The same name and the same address twice is one link typed twice, and
    // storing both would put the same chip on the page twice.
    expect(
      links(
        postRows([
          ['Discord', 'https://discord.gg/abc'],
          ['Discord', 'https://discord.gg/abc'],
        ]),
      ),
    ).toHaveLength(1)
  })

  it('keeps two links to the same address under different names', () => {
    expect(
      links(
        postRows([
          ['Discord', 'https://example.com'],
          ['Forum', 'https://example.com'],
        ]),
      ),
    ).toHaveLength(2)
  })

  it('does not let a name be padded to look like a different link', () => {
    // pairKey joins the two halves. A separator that can occur in a label would
    // let "a" + "b c" and "a b" + "c" collide.
    expect(
      links(
        postRows([
          ['a', 'https://example.com/b'],
          ['a https:', 'https://example.com/b'],
        ]),
      ),
    ).toHaveLength(2)
  })
})

describe('the list as a field on the tool form', () => {
  it('is on the tool form, under the fixed link boxes', () => {
    const fields = LISTING_FORMS.tool.fields
    const extra = fields.find((f) => f.key === EXTRA_LINKS_KEY)
    expect(extra?.kind).toBe('links')
    // Below the seven that have a box of their own, which is where an owner
    // looks after finding none of them fits.
    const lastFixed = fields.map((f) => f.key).lastIndexOf('link_source')
    expect(fields.map((f) => f.key).indexOf(EXTRA_LINKS_KEY)).toBeGreaterThan(lastFixed)
  })

  it('is on the archive variant of the tool form too', () => {
    const keys = listingFormSpec('tool', { inTeamArchive: true }).fields.map((f) => f.key)
    expect(keys).toContain(EXTRA_LINKS_KEY)
  })

  it('is not on a vertical that has no tool_links table behind it', () => {
    for (const entityType of ['album', 'field', 'event', 'grant'] as const) {
      expect(LISTING_FORMS[entityType].fields.map((f) => f.key)).not.toContain(EXTRA_LINKS_KEY)
    }
  })

  it('comes back off parseListingValues as rows, not as a string', () => {
    const fd = postRows([['Discord', 'https://discord.gg/abc']])
    fd.set('name', 'A tool')
    const parsed = parseListingValues(listingFormSpec('tool'), fd, { toolType: ['web_app'] })
    expect('values' in parsed).toBe(true)
    if (!('values' in parsed)) return
    expect(parsed.values[EXTRA_LINKS_KEY]).toEqual([{ label: 'Discord', url: 'https://discord.gg/abc' }])
  })

  it('stops the whole save when a row has a bad address', () => {
    // Not "drop the row and save the rest". The owner typed it, and a save that
    // silently discards one field is the failure this form is most exposed to.
    const fd = postRows([['Discord', 'javascript:alert(1)']])
    fd.set('name', 'A tool')
    const parsed = parseListingValues(listingFormSpec('tool'), fd, { toolType: ['web_app'] })
    expect('error' in parsed).toBe(true)
  })

  it('never reaches the tools table as a column', () => {
    // listingColumnFields drops `link_*` and the non-column kinds. The key here
    // deliberately does NOT start with link_, so the kind is what has to carry
    // it: a `links` field that slipped into the update set would be an
    // "extraLinks column does not exist" on every tool save.
    const extra = LISTING_FORMS.tool.fields.find((f) => f.key === EXTRA_LINKS_KEY)
    expect(extra?.kind).toBe('links')
  })
})

describe('what a save is allowed to touch', () => {
  it('leaves a row whose name and address did not move completely alone', () => {
    // THE WHOLE POINT. This form posts on every blur. A row that comes back
    // unchanged must not be deleted and re-inserted, because that resets
    // is_broken and last_checked_at and throws away what the link checker knows.
    const rows = stored(['r1', 'Discord', 'https://discord.gg/abc'])
    const plan = planExtraLinkWrite(rows, [{ label: 'Discord', url: 'https://discord.gg/abc' }])
    expect(plan).toEqual({ remove: [], insert: [], keep: ['r1'] })
    expect(planIsNoop(plan)).toBe(true)
  })

  it('leaves the untouched rows alone when one of them is added beside them', () => {
    const rows = stored(['r1', 'Discord', 'https://discord.gg/abc'], ['r2', 'Docs', 'https://example.com/docs'])
    const plan = planExtraLinkWrite(rows, [
      { label: 'Discord', url: 'https://discord.gg/abc' },
      { label: 'Docs', url: 'https://example.com/docs' },
      { label: 'Store', url: 'https://example.com/store' },
    ])
    expect(plan.keep).toEqual(['r1', 'r2'])
    expect(plan.remove).toEqual([])
    expect(plan.insert).toEqual([{ label: 'Store', url: 'https://example.com/store' }])
  })

  it('removes a row the owner took off, and nothing else', () => {
    const rows = stored(['r1', 'Discord', 'https://discord.gg/abc'], ['r2', 'Docs', 'https://example.com/docs'])
    const plan = planExtraLinkWrite(rows, [{ label: 'Docs', url: 'https://example.com/docs' }])
    expect(plan.remove).toEqual(['r1'])
    expect(plan.keep).toEqual(['r2'])
    expect(plan.insert).toEqual([])
  })

  it('removes the last row when the owner empties the list', () => {
    const plan = planExtraLinkWrite(stored(['r1', 'Discord', 'https://discord.gg/abc']), [])
    expect(plan.remove).toEqual(['r1'])
    expect(planIsNoop(plan)).toBe(false)
  })

  it('treats a moved address as a new link, because nothing has checked it', () => {
    const rows = stored(['r1', 'Discord', 'https://discord.gg/old'])
    const plan = planExtraLinkWrite(rows, [{ label: 'Discord', url: 'https://discord.gg/new' }])
    expect(plan.remove).toEqual(['r1'])
    expect(plan.insert).toEqual([{ label: 'Discord', url: 'https://discord.gg/new' }])
  })

  it('treats a renamed row as a new link too', () => {
    // The label is what the chip says, and it is stored on the row, so a rename
    // has to reach the row. There is nothing to preserve: the address is what
    // the checker checks and it has not changed, but a row cannot be renamed
    // without being written.
    const rows = stored(['r1', 'Discord', 'https://discord.gg/abc'])
    const plan = planExtraLinkWrite(rows, [{ label: 'Our Discord', url: 'https://discord.gg/abc' }])
    expect(plan.remove).toEqual(['r1'])
    expect(plan.insert).toEqual([{ label: 'Our Discord', url: 'https://discord.gg/abc' }])
  })

  it('matches a stored row with no label against a posted row with no name', () => {
    // NULL in the column and '' in the form are the same thing, and getting
    // this wrong would re-write every unlabelled row on every single autosave.
    const rows = stored(['r1', '', 'https://example.com'])
    const plan = planExtraLinkWrite(rows, [{ label: '', url: 'https://example.com' }])
    expect(planIsNoop(plan)).toBe(true)
    expect(plan.keep).toEqual(['r1'])
  })

  it('does not let one stored row stand in for two posted copies', () => {
    const rows = stored(['r1', 'Discord', 'https://discord.gg/abc'])
    const plan = planExtraLinkWrite(rows, [
      { label: 'Discord', url: 'https://discord.gg/abc' },
      { label: 'Discord', url: 'https://discord.gg/abc' },
    ])
    expect(plan.keep).toEqual(['r1'])
    expect(plan.insert).toHaveLength(1)
  })

  it('keeps both halves of a duplicate the crawler left behind while both are posted', () => {
    const rows = stored(['r1', 'Discord', 'https://discord.gg/abc'], ['r2', 'Discord', 'https://discord.gg/abc'])
    const plan = planExtraLinkWrite(rows, [
      { label: 'Discord', url: 'https://discord.gg/abc' },
      { label: 'Discord', url: 'https://discord.gg/abc' },
    ])
    expect(planIsNoop(plan)).toBe(true)
    expect(plan.keep).toEqual(['r1', 'r2'])
  })

  it('does nothing at all for a tool that has none and posted none', () => {
    expect(planIsNoop(planExtraLinkWrite([], []))).toBe(true)
  })
})
