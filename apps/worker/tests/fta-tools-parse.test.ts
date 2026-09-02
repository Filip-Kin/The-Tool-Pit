/**
 * Reading fta.tools' tool list out of its script.js.
 *
 * The site stopped serving the list as HTML anchors and moved it into a
 * `toolSections` array in script.js, at which point the old anchor scrape
 * imported one junk item, the site's own repo, and none of the real tools.
 * These test the extraction and the sandboxed evaluation without the network.
 */
import { describe, it, expect } from 'bun:test'
import { extractToolSectionsArray, parseToolSections } from '../src/connectors/fta-tools.js'

const SCRIPT = `
  const template = { name: "Tool name" };
  const toolSections = [
    {
      title: "Event Planning",
      description: "Scheduling tools.",
      items: [
        {
          name: "Cycle Time Reports",
          resourceUrl: "http://lopreiato.me/frc-cycle-times/",
          sourceUrl: "https://github.com/phil-lopreiato/frc-cycle-times", // optional
          maintainer: "Phil Lopreiato",
          tags: ["cycle time", "reports"],
        },
        { name: "Nexus for FRC", resourceUrl: "https://frc.nexus/", tags: ["queue"] },
      ],
    },
  ];
  function render() {}
`

describe('fta.tools script parsing', () => {
  it('pulls the toolSections array out, bracket-matched past the trailing code', () => {
    const arr = extractToolSectionsArray(SCRIPT)
    expect(arr).not.toBeNull()
    expect(arr!.startsWith('[')).toBe(true)
    expect(arr!.endsWith(']')).toBe(true)
    // Must not run past the array into the render() function.
    expect(arr).not.toContain('function render')
  })

  it('evaluates the object literal, unquoted keys and comments and all', () => {
    const sections = parseToolSections(extractToolSectionsArray(SCRIPT)!)
    expect(sections).not.toBeNull()
    expect(sections).toHaveLength(1)
    const items = (sections![0] as { items: unknown[] }).items
    expect(items).toHaveLength(2)
    expect((items[0] as { name: string }).name).toBe('Cycle Time Reports')
  })

  it('returns null on a missing array rather than throwing', () => {
    expect(extractToolSectionsArray('const other = 1')).toBeNull()
  })

  it('returns null when the array text is not an array', () => {
    expect(parseToolSections('{ not: "an array" }')).toBeNull()
  })
})
