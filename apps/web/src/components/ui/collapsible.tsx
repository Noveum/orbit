'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/cn.ts';

export interface CollapsibleProps {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Collapsible({ open, children, className }: CollapsibleProps) {
  const [rendered, setRendered] = useState(open);
  const [expanded, setExpanded] = useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(frame);
    }
    setExpanded(false);
    return undefined;
  }, [open]);

  if (!rendered) return null;

  return (
    <div
      data-state={expanded ? 'open' : 'closed'}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-[var(--duration-base)] ease-[var(--ease-out-orbit)]',
        expanded ? 'opacity-100' : 'opacity-0',
      )}
      style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName !== 'grid-template-rows') return;
        if (!expanded) setRendered(false);
      }}
    >
      <div className={cn('min-h-0 overflow-hidden', className)}>{children}</div>
    </div>
  );
}
