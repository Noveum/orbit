'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn.ts';

const clamp = (value: number) => Math.max(180, Math.min(440, value));

export function ResizableRail({
  children,
  storageKey,
  label,
  side = 'left',
  initialWidth = 256,
  className,
}: {
  readonly children: ReactNode;
  readonly storageKey: string;
  readonly label: string;
  readonly side?: 'left' | 'right';
  readonly initialWidth?: number;
  readonly className?: string;
}) {
  const [width, setWidth] = useState(initialWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored > 0) setWidth(clamp(stored));
    } catch {
      return;
    }
  }, [storageKey]);
  const resize = (value: number) => {
    const next = clamp(value);
    setWidth(next);
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      return;
    }
  };
  return (
    <div style={{ width, maxWidth: '100vw' }} className={cn('relative shrink-0', className)}>
      {children}
      <hr
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={180}
        aria-valuemax={440}
        aria-valuenow={width}
        tabIndex={0}
        onDoubleClick={() => resize(initialWidth)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          if (event.key === 'Home') resize(180);
          else if (event.key === 'End') resize(440);
          else resize(width + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1));
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          resize(
            drag.current.width + (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        className={cn(
          'absolute inset-y-0 z-20 m-0 h-full w-1 cursor-col-resize touch-none border-0 bg-transparent hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
          side === 'left' ? 'right-0' : 'left-0',
        )}
      />
    </div>
  );
}
