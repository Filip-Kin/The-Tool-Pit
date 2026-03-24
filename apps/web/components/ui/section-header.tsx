import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface SectionHeaderProps {
  title: string
  description?: string
  href?: string
  linkLabel?: string
  className?: string
}

export function SectionHeader({ title, description, href, linkLabel, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-6 flex items-end justify-between gap-4', className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-sm text-muted">{description}</p>
        )}
      </div>
      {href && linkLabel && (
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 text-sm text-primary hover:text-primary-hover transition-colors"
        >
          {linkLabel}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}
