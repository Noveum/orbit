'use client';

import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';

export function IntegrationCard({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium text-dense text-text">{title}</h3>
          {status}
        </div>
        <p className="text-muted text-xs">{description}</p>
      </div>
      {children}
    </section>
  );
}

const COPY_FAILED = 'Could not copy to the clipboard. Select and copy it manually.';

export function useCopy(onError: (message: string) => void): {
  copied: boolean;
  copy: (value: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError(COPY_FAILED);
    }
  }

  return { copied, copy };
}

export function CopyRow({
  value,
  label,
  testId,
  onError,
}: {
  value: string;
  label: string;
  testId?: string;
  onError: (message: string) => void;
}) {
  const { copied, copy } = useCopy(onError);

  async function handleCopy(): Promise<void> {
    await copy(value);
  }

  return (
    <div className="flex items-center gap-2">
      <code
        {...(testId === undefined ? {} : { 'data-testid': testId })}
        className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-dense text-text"
      >
        {value}
      </code>
      <Button variant="secondary" onClick={handleCopy} aria-label={label}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
