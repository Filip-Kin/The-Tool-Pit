'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { FieldPhotoRef } from '@/lib/fields/field-display'
import { cn } from '@/lib/utils/cn'

/**
 * Field photo gallery: a cover image with a thumbnail strip beneath, and a
 * full-screen lightbox with prev/next. The lightbox is portalled to <body> so
 * it escapes the map dialog's transformed stacking context.
 */
export function FieldGallery({ photos, alt }: { photos: FieldPhotoRef[]; alt: string }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  if (photos.length === 0) return null

  function openAt(i: number) {
    setIndex(i)
    setOpen(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => openAt(0)}
        className="group relative overflow-hidden rounded-lg border border-border"
        aria-label="Open photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[0].url} alt={`${alt} field`} className="max-h-96 w-full object-cover transition-transform group-hover:scale-[1.02]" />
        {photos.length > 1 && (
          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            1 / {photos.length}
          </span>
        )}
      </button>

      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openAt(i)}
              className="shrink-0 overflow-hidden rounded-md border border-border-subtle hover:border-border"
              aria-label={`Open photo ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`${alt} field ${i + 1}`} className="h-16 w-20 object-cover" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <Lightbox
          photos={photos}
          index={index}
          alt={alt}
          onIndex={setIndex}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function Lightbox({
  photos,
  index,
  alt,
  onIndex,
  onClose,
}: {
  photos: FieldPhotoRef[]
  index: number
  alt: string
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const many = photos.length > 1
  const prev = () => onIndex((index - 1 + photos.length) % photos.length)
  const next = () => onIndex((index + 1) % photos.length)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && many) prev()
      else if (e.key === 'ArrowRight' && many) next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, many])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} photos`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white"
      >
        <X className="h-6 w-6" />
      </button>

      {many && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); prev() }}
          aria-label="Previous photo"
          className="absolute left-2 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white sm:left-4"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[index].url}
        alt={`${alt} field ${index + 1}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-full rounded-lg object-contain"
      />

      {many && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); next() }}
          aria-label="Next photo"
          className="absolute right-2 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white sm:right-4"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      )}

      {many && (
        <div className={cn('absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white')}>
          {index + 1} / {photos.length}
        </div>
      )}
    </div>,
    document.body,
  )
}
