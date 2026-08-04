import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StandupPage } from '@/features/standup/standup-page.tsx';

export const metadata: Metadata = { title: 'Standup' };

export default function Standup() {
  return (
    <Suspense fallback={null}>
      <StandupPage />
    </Suspense>
  );
}
