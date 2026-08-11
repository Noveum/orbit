'use client';

import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';

export interface LoadFailedProps {
  readonly subject: string;
  readonly onRetry: () => void;
  readonly testId: string;
}

export function LoadFailed({ subject, onRetry, testId }: LoadFailedProps) {
  return (
    <EmptyState
      icon={<WifiOff strokeWidth={1.75} aria-hidden="true" />}
      title={`Could not load ${subject}`}
      description="The request did not come back, so this is not empty, it is unread. Try again."
      className="flex-1"
      action={
        <Button size="sm" variant="secondary" data-testid={testId} onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}
