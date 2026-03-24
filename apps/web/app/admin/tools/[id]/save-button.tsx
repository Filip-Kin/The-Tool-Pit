'use client'

import { useFormStatus } from 'react-dom'

export function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save Changes'}
    </button>
  )
}
