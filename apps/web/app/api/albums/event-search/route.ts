import { type NextRequest, NextResponse } from 'next/server'
import { searchEventsForSubmission } from '@/lib/queries/albums'

/**
 * Event autocomplete for the submission form. Searches all events (with or
 * without albums) in the given program so a submitter can pick the exact event
 * and auto-fill its code + year.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const program = req.nextUrl.searchParams.get('program') === 'ftc' ? 'ftc' : 'frc'
  if (!q.trim()) return NextResponse.json([])
  try {
    const events = await searchEventsForSubmission(q, program)
    return NextResponse.json(events, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json([])
  }
}
