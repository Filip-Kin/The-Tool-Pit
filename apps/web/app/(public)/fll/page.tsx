import type { Metadata } from 'next'
import { ProgramPage } from '@/components/program/program-page'

export const metadata: Metadata = {
  title: 'FLL Tools',
  description: 'Tools and resources for FIRST LEGO League (FLL) teams.',
}

export default function FllPage() {
  return <ProgramPage program="fll" />
}
