import type { Metadata } from 'next'
import { ProgramPage } from '@/components/program/program-page'

export const metadata: Metadata = {
  title: 'FRC Tools',
  description: 'Tools and resources for FIRST Robotics Competition (FRC) teams.',
}

export default function FrcPage() {
  return <ProgramPage program="frc" />
}
