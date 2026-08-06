import Link from 'next/link'
import { MapPin } from 'lucide-react'

export function FieldsHeader() {
  return (
    <header className="sticky top-0 z-[500] border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold tracking-tight text-foreground">Practice Field Map</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          <Link
            href="/submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Add a field
          </Link>
        </nav>
      </div>
    </header>
  )
}
