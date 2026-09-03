import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/components/auth/session-provider'
import { getCurrentUser } from '@/lib/auth/session'
import { Analytics } from '@/components/layout/analytics'
import { THEME_INIT_SCRIPT } from '@/lib/theme/theme'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'The Tool Pit: FIRST Robotics Tool Directory',
    template: '%s | The Tool Pit',
  },
  description:
    'Tools, calculators and apps for FRC, FTC and FLL teams. Browse by program or search by what you need, and bookmark the ones your team keeps reaching for.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_URL ?? 'https://frc.tools'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'FRC.tools',
    url: '/',
    title: 'The Tool Pit: FIRST Robotics Tool Directory',
    description:
      'Tools, calculators and apps for FRC, FTC and FLL teams. Browse by program or search by what you need, and bookmark the ones your team keeps reaching for.',
  },
  // The default share card is app/opengraph-image.tsx, which Next.js merges into
  // both openGraph.images and twitter.images for every route automatically, so
  // a page only needs to set the card type here.
  twitter: {
    card: 'summary_large_image',
    title: 'The Tool Pit: FIRST Robotics Tool Directory',
    description:
      'Tools, calculators and apps for FRC, FTC and FLL teams. Browse by program or search by what you need, and bookmark the ones your team keeps reaching for.',
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the session on the server so the header renders signed-in on the
  // first paint instead of flashing a "Sign in" button and then swapping.
  const user = await getCurrentUser()

  return (
    // suppressHydrationWarning because the head script below sets data-theme on
    // this element before React ever sees it. The attribute is the one thing in
    // the document the server genuinely cannot know: it depends on the
    // visitor's localStorage and on what their OS is doing.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Resolve the theme before the first paint. In a useEffect this is a
            white flash on every load for anyone running a light desktop. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* suppressHydrationWarning for the same reason as <html>, a different
          writer. Browser extensions stamp their own attributes on the body
          before React hydrates: Grammarly adds data-gr-ext-installed and
          data-new-gr-c-s-check-loaded, and React reports the difference as a
          hydration mismatch in an app that has done nothing wrong. The flag
          only covers THIS element's own attributes and text, one level deep,
          so a genuine mismatch anywhere inside the tree is still reported. */}
      <body suppressHydrationWarning>
        <SessionProvider
          initialUser={
            user
              ? {
                  id: user.id,
                  email: user.email,
                  displayName: user.displayName,
                  photoUrl: user.photoUrl,
                  githubLogin: user.githubLogin,
                }
              : null
          }
        >
          {children}
        </SessionProvider>
        <Analytics />
      </body>
    </html>
  )
}
