import type { Metadata } from 'next';
import { StandupWorkspace } from '@/features/standup/standup-workspace.tsx';

export const metadata: Metadata = { title: 'Standup' };

export default function Standup() {
  return <StandupWorkspace />;
}
