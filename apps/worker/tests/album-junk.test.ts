import { describe, it, expect } from 'vitest'
import { classifyAlbumJunk, ALBUM_JUNK_REASONS } from '../src/jobs/album-junk.js'

/** A real event album that must never be flagged, defaults overridden per-case. */
function real(over: Partial<Parameters<typeof classifyAlbumJunk>[0]> = {}) {
  return classifyAlbumJunk({
    canonicalUrl: 'https://firstwisconsin.smugmug.com/FIRST-Robotics-Competition/2026-FRC-La-Crosse-District-Event/x',
    sourceUrl: 'https://firstinmichigan.us/FRC/milav/',
    targetEventCode: 'milav',
    title: '2026 FRC La Crosse District Event Greg Blau',
    threadTitle: undefined,
    blurb: undefined,
    ...over,
  })
}

describe('classifyAlbumJunk', () => {
  it('flags Open Alliance from the thread title', () => {
    expect(
      classifyAlbumJunk({
        canonicalUrl: 'https://drive.google.com/drive/folders/abc',
        sourceUrl: 'https://www.chiefdelphi.com/t/pontiac-firebirds/123',
        threadTitle: 'Pontiac Firebirds 10349 | Open Alliance 2025 Build Thread',
      }),
    ).toEqual({ reason: ALBUM_JUNK_REASONS.openAlliance })
  })

  it('flags Open Alliance from a CD thread slug in the URL', () => {
    expect(
      classifyAlbumJunk({
        canonicalUrl: null,
        sourceUrl: 'https://www.chiefdelphi.com/t/1234-2025-open-alliance/999',
      }),
    ).toEqual({ reason: ALBUM_JUNK_REASONS.openAlliance })
  })

  it('flags a YouTube link as not a photo album', () => {
    expect(
      classifyAlbumJunk({
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        sourceUrl: 'https://firstinmichigan.us/FRC/milav/',
      }),
    ).toEqual({ reason: ALBUM_JUNK_REASONS.notPhotoAlbum })
    expect(
      classifyAlbumJunk({
        canonicalUrl: 'https://youtu.be/dQw4w9WgXcQ',
        sourceUrl: 'https://example.com',
      }),
    ).toEqual({ reason: ALBUM_JUNK_REASONS.notPhotoAlbum })
    expect(
      classifyAlbumJunk({
        canonicalUrl: 'https://vimeo.com/76979871',
        sourceUrl: 'https://example.com',
      }),
    ).toEqual({ reason: ALBUM_JUNK_REASONS.notPhotoAlbum })
  })

  it('flags a general team gallery with no event and no year', () => {
    expect(
      classifyAlbumJunk({
        canonicalUrl: 'https://team1234.smugmug.com/Photos',
        sourceUrl: 'https://team1234.smugmug.com/Photos',
        targetEventCode: null,
        title: 'Team Photos',
      }),
    ).toEqual({ reason: ALBUM_JUNK_REASONS.notEventPhotos })
    expect(real({ targetEventCode: null, title: 'Robodox Media Gallery' })).toEqual({
      reason: ALBUM_JUNK_REASONS.notEventPhotos,
    })
  })

  it('leaves a normal FiM event album alone', () => {
    expect(real()).toBeNull()
  })

  it('does not flag "Full Event Gallery" as a general gallery', () => {
    // "full ... gallery" is a real event album; the marker must sit immediately
    // before the gallery noun, so this must pass through.
    expect(real({ targetEventCode: null, title: 'Waco 2025 Full Event Gallery' })).toBeNull()
  })

  it('does not flag a gallery-worded title once a year is present', () => {
    // A year is the event album's own signal, so "our photos 2025" is left for
    // the matcher rather than dropped.
    expect(real({ targetEventCode: null, title: 'Our Photos 2025 Troy District' })).toBeNull()
  })

  it('does not flag a gallery-worded title when the crawl already named an event', () => {
    expect(real({ targetEventCode: 'mitry', title: 'Team Photos' })).toBeNull()
  })

  it('does not flag SmugMug/Flickr/Drive event albums as videos', () => {
    expect(real({ canonicalUrl: 'https://www.flickr.com/photos/frc1234/albums/72177720312345678' })).toBeNull()
    expect(real({ canonicalUrl: 'https://drive.google.com/drive/folders/abc' })).toBeNull()
  })
})
