'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

export function SaveButton({ label = 'Save Changes' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}
