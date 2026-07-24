'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn.ts';

type Phase = 'idle' | 'in' | 'out';

export interface CollapsibleProps {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Collapsible({ open, children, className }: CollapsibleProps) {
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<Phase>('idle');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (open) {
      setRendered(true);
      setPhase('in');
    } else {
      setPhase('out');
    }
  }, [open]);

  if (!rendered) return null;

  return (
    <div
      className={cn(
        'origin-top',
        phase === 'in' && 'animate-accordion-in',
        phase === 'out' && 'animate-accordion-out',
        className,
      )}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (phase === 'out') setRendered(false);
        setPhase('idle');
      }}
    >
      {children}
    </div>
  );
}
