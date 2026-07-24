import type { Metadata } from 'next';
import { StandupView } from '@/features/issues/standup-view.tsx';

export const metadata: Metadata = { title: 'Standup' };

export default function StandupPage() {
  return <StandupView layout="list" />;
}
