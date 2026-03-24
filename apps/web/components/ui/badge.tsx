import { cn } from '@/lib/utils/cn'

type BadgeVariant = 'official' | 'vendor' | 'rookie' | 'program' | 'default' | 'muted'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  official: 'bg-official/15 text-official border-official/30',
  vendor: 'bg-vendor/15 text-vendor border-vendor/30',
  rookie: 'bg-rookie/15 text-rookie border-rookie/30',
  program: 'bg-primary/15 text-primary border-primary/30',
  default: 'bg-surface-2 text-muted border-border',
  muted: 'bg-transparent text-muted-2 border-border-subtle',
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
