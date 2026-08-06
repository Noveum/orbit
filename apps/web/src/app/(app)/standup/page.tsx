import type { Metadata } from 'next';
import { StandupBoard } from '@/features/standup/standup-board.tsx';

export const metadata: Metadata = { title: 'Standup' };

export default function Standup() {
  return <StandupBoard />;
}
