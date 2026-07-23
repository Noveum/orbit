import { Compass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center" data-testid="not-found">
      <EmptyState
        icon={<Compass strokeWidth={1.75} aria-hidden="true" />}
        title="This page does not exist"
        description="Nothing lives at this address. It may have moved, or it may be a surface Orbit has not built yet."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/my-issues">Back to my issues</Link>
          </Button>
        }
      />
    </main>
  );
}
