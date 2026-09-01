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
    'Discover tools, calculators, apps, and resources for FRC, FTC, and FLL teams. The community directory for FIRST robotics.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_URL ?? 'https://frc.tools'),
  openGraph: {
    type: 'website',
    siteName: 'The Tool Pit',
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
      <body>
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
