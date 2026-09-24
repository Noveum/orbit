'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import type { SetupValue } from './deployment-guides.ts';

export function SetupCopyValue({ label, value }: SetupValue) {
  const [status, setStatus] = useState('');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Copied.');
    } catch {
      setStatus('Could not copy. Select and copy the text below.');
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-xs text-text">{label}</p>
        <Button variant="ghost" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
          Copy
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface-2 p-3 text-2xs text-muted">
        {value}
      </pre>
      {status.length > 0 ? (
        <p role="status" className="text-muted text-xs">
          {status}
        </p>
      ) : null}
    </div>
  );
}
