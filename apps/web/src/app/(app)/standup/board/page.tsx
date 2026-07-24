import type { Metadata } from 'next';
import { StandupView } from '@/features/issues/standup-view.tsx';

export const metadata: Metadata = { title: 'Standup board' };

export default function StandupBoardPage() {
  return <StandupView layout="board" />;
}
