import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'The Tool Pit — FIRST Robotics Tool Directory',
    template: '%s | The Tool Pit',
  },
  description:
    'Discover tools, calculators, apps, and resources for FRC, FTC, and FLL teams. The community directory for FIRST robotics.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_URL ?? 'https://thetoolpit.com'),
  openGraph: {
    type: 'website',
    siteName: 'The Tool Pit',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
