import type { ReactNode } from 'react';
import { OrbitWordmark } from '@/components/brand/orbit-logo.tsx';
import { requireSession } from '@/lib/auth/session.ts';

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-5 py-12">
      <div className="flex w-full max-w-xl flex-col items-center gap-8">
        <OrbitWordmark size={18} className="text-muted" />
        {children}
      </div>
    </main>
  );
}
