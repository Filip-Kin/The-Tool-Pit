import { cn } from '@/lib/utils/cn'

type BadgeVariant = 'official' | 'vendor' | 'rookie' | 'program' | 'default' | 'muted'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  official: 'bg-[var(--color-official)]/15 text-[var(--color-official)] border-[var(--color-official)]/30',
  vendor: 'bg-[var(--color-vendor)]/15 text-[var(--color-vendor)] border-[var(--color-vendor)]/30',
  rookie: 'bg-[var(--color-rookie)]/15 text-[var(--color-rookie)] border-[var(--color-rookie)]/30',
  program: 'bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/30',
  default: 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border-[var(--color-border)]',
  muted: 'bg-transparent text-[var(--color-muted-2)] border-[var(--color-border-subtle)]',
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
