import { ImageResponse } from 'next/og'

/**
 * Shared 1200x630 share card for the per-listing OpenGraph images.
 *
 * Every listing detail route (event, field, grant, tool) has its own
 * `opengraph-image.tsx` that loads that one listing and hands its facts here,
 * so a shared link unfurls with the listing's own name and details instead of
 * the site-wide card in `app/opengraph-image.tsx`. The visual language matches
 * that static card on purpose: the same dark background, the same frc.tools
 * wordmark, the same indigo accent, so a per-listing card and the site card
 * read as one family.
 */

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

const BG = '#0a0a0b'
const INK = '#f0f0f2'
const MUTED = '#9ca3af'
const MUTED_2 = '#6b7280'
const ACCENT = '#6366f1'

interface OgCardInput {
  /** Small category line above the title, e.g. "FRC off-season event". */
  eyebrow: string
  /** The listing's own name, shown large. */
  title: string
  /** One or two lines of key facts under the title. Empty strings are skipped. */
  facts: string[]
}

/**
 * Render one branded listing card to a 1200x630 PNG.
 *
 * Title size steps down as the name gets longer so a long event name still
 * fits without overflowing the card, and the title is clamped to three lines
 * as a final guard. Facts are the muted supporting line(s): a date and a
 * place, an award and a deadline, whatever the route passed.
 */
export function renderOgCard({ eyebrow, title, facts }: OgCardInput): ImageResponse {
  const titleSize = title.length > 64 ? 60 : title.length > 40 ? 74 : 88
  const lines = facts.filter((f) => f && f.trim().length > 0)

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: BG,
          padding: '72px 80px',
        }}
      >
        {/* Wordmark + category, the frc.tools lockup from the site card. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 52,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: INK,
            }}
          >
            frc<span style={{ color: ACCENT }}>.tools</span>
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 30, fontWeight: 600, color: ACCENT }}>
            {eyebrow}
          </div>
        </div>

        {/* The listing's own name, then its key facts. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
              overflow: 'hidden',
              fontSize: titleSize,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              color: INK,
            }}
          >
            {title}
          </div>
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                marginTop: i === 0 ? 28 : 8,
                fontSize: 38,
                fontWeight: 500,
                color: i === 0 ? MUTED : MUTED_2,
              }}
            >
              {line}
            </div>
          ))}
        </div>

        {/* Accent bar, same as the site card. */}
        <div style={{ display: 'flex', height: 10, width: 220, borderRadius: 999, backgroundColor: ACCENT }} />
      </div>
    ),
    { ...OG_SIZE },
  )
}

/**
 * Fallback card for a listing that could not be loaded (deleted, unpublished,
 * a bad id). Still branded, still legible, just the site line instead of a
 * name we do not have.
 */
export function renderOgFallback(eyebrow: string): ImageResponse {
  return renderOgCard({
    eyebrow,
    title: 'Listing not found',
    facts: ['Tools, events, practice fields and grants for FIRST robotics teams'],
  })
}
