/**
 * Guard: publishing an event candidate closes its twin.
 *
 * The same off-season event reaches us as two candidates, one from TBA and one
 * from a Chief Delphi thread. Insert-time dedupe runs on tba_key and canonical
 * URL, but publishing one candidate did nothing to the other, which sat in
 * pending until a human noticed (2026cc, 2026nycrr, 2026rsr were exactly this).
 *
 * These are source-shape checks, the same style as accept-means-publish: the
 * accept path has to call the closer, and the closer has to match a twin the
 * two documented ways (shared tba_key, shared URL), mark it 'duplicate', point
 * it at the just-published listing, and only ever touch rows still pending so a
 * second publish is a no-op.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '../../../..')
const FILE = 'apps/web/app/admin/event-listings/candidates/actions.ts'

function read(file: string): string {
  return readFileSync(join(REPO, file), 'utf8')
}

describe('closing a twin candidate on publish', () => {
  const source = read(FILE)

  it('accepting a candidate calls the twin closer', () => {
    expect(source).toContain('closeTwinCandidates(candidate, created.id)')
  })

  it('marks the twin a duplicate, pointed at the published listing', () => {
    expect(source).toContain("status: 'duplicate'")
    expect(source).toContain('matchedListingId: listingId')
  })

  it('matches a twin by shared tba_key and by shared URL', () => {
    // tba_key closes a TBA twin of a CD publish and the reverse; the URL match
    // closes a second lead scraped off the same page.
    expect(source).toContain('inArray(eventListingCandidates.tbaKey, keys)')
    expect(source).toContain('inArray(eventListingCandidates.canonicalUrl, urls)')
    expect(source).toContain('inArray(eventListingCandidates.sourceUrl, urls)')
  })

  it('only touches rows still pending, never the just-published one', () => {
    // Idempotent: a second publish for the same event finds nothing to close.
    expect(source).toContain("eq(eventListingCandidates.status, 'pending')")
    expect(source).toContain('ne(eventListingCandidates.id, candidate.id)')
  })

  it('reads the published listing tba_key, so a hand-typed key still matches', () => {
    // A CD thread arrives with no tba_key; the admin types one onto the listing
    // while accepting, and that key is how the pending TBA twin is recognised.
    expect(source).toContain('candidate.tbaKey, listing?.tbaKey')
  })
})
