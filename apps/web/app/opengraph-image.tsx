import { ImageResponse } from 'next/og'

/**
 * The default share card for every page that does not set its own.
 *
 * Next.js picks this file up automatically and adds it to the OpenGraph and
 * Twitter image metadata site-wide, so a link to any frc.tools page unfurls
 * with this card unless a route overrides it. A clean dark card, the wordmark,
 * one line of what the site is.
 */
export const alt = 'FRC.tools — the FIRST robotics tool, event, field and grant directory'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          backgroundColor: '#0a0a0b',
          padding: '80px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 140,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            color: '#f0f0f2',
          }}
        >
          frc<span style={{ color: '#6366f1' }}>.tools</span>
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 46,
            fontWeight: 500,
            color: '#9ca3af',
          }}
        >
          Tools, events, practice fields and grants for FIRST robotics teams
        </div>
        <div
          style={{
            marginTop: 56,
            height: 10,
            width: 220,
            borderRadius: 999,
            backgroundColor: '#6366f1',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
