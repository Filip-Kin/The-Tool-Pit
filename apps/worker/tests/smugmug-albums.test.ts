import { describe, it, expect } from 'vitest'
import {
  descend,
  isSkippedFolder,
  smugAlbumToCandidate,
  type PathContext,
  type SmugNode,
} from '../src/connectors/smugmug-albums.js'

const album = (Name: string, WebUri: string): SmugNode => ({ Type: 'Album', Name, UrlPath: '', WebUri, NodeID: 'x' })
const root: PathContext = { names: [], year: undefined, program: 'frc' }

describe('SmugMug path context', () => {
  it('does not take a year from a "Pre-2022" bucket', () => {
    const ctx = descend(root, 'Pre-2022')
    expect(ctx.year).toBeUndefined()
    expect(ctx.names).toEqual([])
    const cand = smugAlbumToCandidate(
      album('Del Rio 2019', 'https://fit.smugmug.com/FIRST-Robotics-Competition/Pre-2022/Del-Rio-2019'),
      'https://fit.smugmug.com/FIRST-Robotics-Competition/',
      ctx,
    )
    expect(cand?.targetEventYear).toBe(2019)
    expect(cand?.rawMetadata?.title).toBe('Del Rio 2019')
  })

  it('leaves the year undefined under a Pre- bucket when the leaf has none', () => {
    const ctx = descend(descend(root, '2023'), 'Pre-2022')
    const cand = smugAlbumToCandidate(
      album('Del Rio', 'https://fit.smugmug.com/FIRST-Robotics-Competition/Pre-2022/Del-Rio'),
      'https://fit.smugmug.com/FIRST-Robotics-Competition/',
      ctx,
    )
    expect(cand?.targetEventYear).toBeUndefined()
  })

  it('still takes the year from a plain year folder', () => {
    const ctx = descend(root, '2025')
    expect(ctx.year).toBe(2025)
    const cand = smugAlbumToCandidate(
      album('Del Rio', 'https://fit.smugmug.com/FIRST-Robotics-Competition/2025/Del-Rio'),
      'https://fit.smugmug.com/FIRST-Robotics-Competition/',
      ctx,
    )
    expect(cand?.targetEventYear).toBe(2025)
  })

  it('skips "Folder Images" cover albums', () => {
    expect(
      smugAlbumToCandidate(album('Folder Images', 'https://fit.smugmug.com/x/Folder-Images'), 'https://fit.smugmug.com/', root),
    ).toBeNull()
  })

  it('skips non-competition folders but not event folders', () => {
    for (const n of ['FIRST Demonstrations', 'Notable Events', 'Community Celebrations', 'Kickoff', 'Kickoff 2025']) {
      expect(isSkippedFolder(n)).toBe(true)
    }
    for (const n of ['Robots on Fire', 'Del Rio', '2025', 'Seven Rivers Regional']) {
      expect(isSkippedFolder(n)).toBe(false)
    }
  })
})
