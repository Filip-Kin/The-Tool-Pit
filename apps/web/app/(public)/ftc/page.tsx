import type { Metadata } from 'next'
import { ProgramPage } from '@/components/program/program-page'

export const metadata: Metadata = {
  title: 'FTC Tools',
  description: 'Tools and resources for FIRST Tech Challenge (FTC) teams.',
}

export default function FtcPage() {
  return <ProgramPage program="ftc" />
}
