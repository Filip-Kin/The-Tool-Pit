import type { ReactNode } from 'react'
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
  /**
   * An ABSOLUTE image URL to show beside the text, for listings that have a
   * cover photo (practice fields, photo albums). When set, the card becomes two
   * columns: the branded text panel on the left, the photo filling the right.
   * When absent the card is the full-width text layout.
   */
  photoUrl?: string
}

/**
 * Render one branded listing card to a 1200x630 PNG.
 *
 * Title size steps down as the name gets longer so a long event name still
 * fits without overflowing the card, and the title is clamped to three lines
 * as a final guard. Facts are the muted supporting line(s): a date and a
 * place, an award and a deadline, whatever the route passed.
 */
export function renderOgCard({ eyebrow, title, facts, photoUrl }: OgCardInput): ImageResponse {
  const hasPhoto = Boolean(photoUrl)
  // The photo takes ~45% of the width, so the title has to step down sooner
  // when it is present to keep fitting the narrower text panel.
  const titleSize = hasPhoto
    ? title.length > 48 ? 46 : title.length > 28 ? 56 : 66
    : title.length > 64 ? 60 : title.length > 40 ? 74 : 88
  const lines = facts.filter((f) => f && f.trim().length > 0)

  const panel = (
    <div
      style={{
        height: '100%',
        width: hasPhoto ? '660px' : '100%',
        flexShrink: 0,
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
  )

  return new ImageResponse(
    (
      <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'row', backgroundColor: BG }}>
        {panel}
        {hasPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            width={540}
            height={630}
            style={{ width: '540px', height: '630px', objectFit: 'cover' }}
          />
        )}
      </div>
    ),
    { ...OG_SIZE },
  )
}

interface VerticalOgInput {
  /** The vertical's own name, shown large, e.g. "Off-season events". */
  name: string
  /** One line under the name saying what the section is. */
  tagline: string
  /**
   * The vertical's lucide icon, as its bare SVG primitives (path / circle /
   * rect) on the standard lucide 24x24 grid. The card wraps them in a stroked
   * <svg>, so a route passes the same glyph the site shows the vertical with.
   */
  icon: ReactNode
}

/**
 * Render one vertical's INDEX share card to a 1200x630 PNG.
 *
 * Where the per-listing card (renderOgCard) fronts one event or tool, this
 * fronts a whole section. Sharing frc.tools/events or /fields used to unfurl the
 * site-wide card, so every section looked the same in Discord or iMessage. This
 * leads with the section's own lucide icon, big, in the indigo brand tint, then
 * the section name and a one-line tagline, so a person seeing it knows at a
 * glance which section it is.
 *
 * The accent stays indigo for every vertical because the site shows all of them
 * in the one brand indigo (the header switcher, the home vertical cards, the
 * favicons are all #6366f1); the icon is what tells them apart. A soft indigo
 * glow top-right keeps the background off flat black.
 */
export function renderVerticalOgCard({ name, tagline, icon }: VerticalOgInput): ImageResponse {
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
          backgroundImage: 'radial-gradient(circle at 82% 18%, rgba(99,102,241,0.28), rgba(10,10,11,0) 58%)',
          padding: '72px 80px',
        }}
      >
        {/* The frc.tools lockup, same as the site card. */}
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

        {/* The section's icon, big and in the brand tint, then its name and tagline. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 168,
              height: 168,
              borderRadius: 40,
              backgroundColor: 'rgba(99,102,241,0.12)',
              border: '2px solid rgba(99,102,241,0.4)',
            }}
          >
            <svg
              width={96}
              height={96}
              viewBox="0 0 24 24"
              fill="none"
              stroke={ACCENT}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {icon}
            </svg>
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 40,
              fontSize: 82,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              color: INK,
            }}
          >
            {name}
          </div>
          <div
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
              marginTop: 18,
              fontSize: 38,
              fontWeight: 500,
              lineHeight: 1.25,
              color: MUTED,
            }}
          >
            {tagline}
          </div>
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
