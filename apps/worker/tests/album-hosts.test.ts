import { describe, it, expect } from 'vitest'
import { canonicalizeAlbumUrl, detectAlbumProvider } from '../src/connectors/album-hosts.js'

describe('canonicalizeAlbumUrl', () => {
  it('recognizes SmugMug galleries on any subdomain', () => {
    expect(canonicalizeAlbumUrl('https://emmablakleyphotography.smugmug.com/FIRST-Robotics/2026-FIM-Midland-FRC'))
      .toEqual({
        canonicalUrl: 'https://emmablakleyphotography.smugmug.com/FIRST-Robotics/2026-FIM-Midland-FRC',
        provider: 'smugmug',
      })
  })

  it('strips a SmugMug individual-photo segment back to its gallery', () => {
    expect(canonicalizeAlbumUrl('https://user.smugmug.com/Event/Gallery-2024/i-XsT9TXz/0/abc/XL/DSC_9997-XL.jpg'))
      .toEqual({ canonicalUrl: 'https://user.smugmug.com/Event/Gallery-2024', provider: 'smugmug' })
  })

  it('rejects the SmugMug media CDN and bare-root homepages', () => {
    expect(canonicalizeAlbumUrl('https://photos.smugmug.com/2021-FRC/Gamma/i-XFVqwXT/0/x/X2/slide.png')).toBeNull()
    expect(canonicalizeAlbumUrl('https://robodox.smugmug.com')).toBeNull()
    expect(canonicalizeAlbumUrl('https://robodox.smugmug.com/')).toBeNull()
  })

  it('recognizes Pixieset galleries and strips trailing slash', () => {
    expect(canonicalizeAlbumUrl('https://jaredmilesphoto.pixieset.com/frcmid2026/'))
      .toEqual({ canonicalUrl: 'https://jaredmilesphoto.pixieset.com/frcmid2026', provider: 'pixieset' })
  })

  it('recognizes Flickr albums but rejects a bare profile', () => {
    expect(canonicalizeAlbumUrl('https://www.flickr.com/photos/frc1234/albums/72177720312345678'))
      .toEqual({
        canonicalUrl: 'https://www.flickr.com/photos/frc1234/albums/72177720312345678',
        provider: 'flickr',
      })
    expect(canonicalizeAlbumUrl('https://www.flickr.com/photos/frc1234')).toBeNull()
  })

  it('recognizes Google Photos shares and keeps the key param', () => {
    expect(canonicalizeAlbumUrl('https://photos.google.com/share/AF1QipABC?key=XYZ&hl=en'))
      .toEqual({ canonicalUrl: 'https://photos.google.com/share/AF1QipABC?key=XYZ', provider: 'google_photos' })
    expect(canonicalizeAlbumUrl('https://photos.app.goo.gl/abc123')?.provider).toBe('google_photos')
  })

  it('recognizes Google Drive shared folders', () => {
    expect(canonicalizeAlbumUrl('https://drive.google.com/drive/folders/1aIBDNv2HoBa-znwnS_1Z3CRN4dk7OnYx'))
      .toEqual({ canonicalUrl: 'https://drive.google.com/drive/folders/1aIBDNv2HoBa-znwnS_1Z3CRN4dk7OnYx', provider: 'google_drive' })
    expect(canonicalizeAlbumUrl('https://drive.google.com/drive/u/0/folders/ABC-123_x?usp=sharing'))
      .toEqual({ canonicalUrl: 'https://drive.google.com/drive/folders/ABC-123_x', provider: 'google_drive' })
    expect(canonicalizeAlbumUrl('https://drive.google.com/file/d/xyz/view')).toBeNull()
  })

  it('rejects non-album hosts by default', () => {
    expect(canonicalizeAlbumUrl('https://github.com/foo/bar')).toBeNull()
    expect(canonicalizeAlbumUrl('https://www.chiefdelphi.com/t/thread/123')).toBeNull()
  })

  it('accepts unknown hosts when allowUnknown is set (trusted FiM anchors)', () => {
    expect(canonicalizeAlbumUrl('https://somephotographer.com/gallery/frc/', { allowUnknown: true }))
      .toEqual({ canonicalUrl: 'https://somephotographer.com/gallery/frc', provider: 'other' })
  })

  it('strips trailing punctuation from forum-scraped URLs', () => {
    expect(canonicalizeAlbumUrl('https://x.smugmug.com/Event/Gallery).')?.canonicalUrl)
      .toBe('https://x.smugmug.com/Event/Gallery')
  })

  it('rejects SmugMug folder listings (single path segment) and old-format photo URLs', () => {
    expect(canonicalizeAlbumUrl('https://davewilson.smugmug.com/Robotics')).toBeNull()
    expect(canonicalizeAlbumUrl('http://billbo911.smugmug.com/Hobbies/Cal-Games-2009/9936059_Q79X9/1/677895428_FkvhD'))
      .toEqual({ canonicalUrl: 'https://billbo911.smugmug.com/Hobbies/Cal-Games-2009', provider: 'smugmug' })
  })
})

describe('detectAlbumProvider', () => {
  it('returns the provider or null', () => {
    expect(detectAlbumProvider('https://x.pixieset.com/g')).toBe('pixieset')
    expect(detectAlbumProvider('https://example.com/foo')).toBeNull()
  })
})
