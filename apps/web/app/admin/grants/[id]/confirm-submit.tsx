'use client'

/**
 * A submit button that asks first. The editor is otherwise plain server-action
 * forms, and this is the only client-side behaviour it needs: deleting a cycle
 * or a requirement is not undoable, and neither is unpublishing something teams
 * may already have bookmarked.
 */
export function ConfirmSubmit({
  message,
  children,
  className,
}: {
  message: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault()
      }}
    >
      {children}
    </button>
  )
}
