'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/cn.ts';

export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;
export const DEFAULT_SPLIT_RATIO = 0.5;
const KEYBOARD_STEP = 0.02;

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.max(MIN_SPLIT_RATIO, Math.min(value, MAX_SPLIT_RATIO));
}

function readStoredRatio(key: string): number {
  if (typeof window === 'undefined') return DEFAULT_SPLIT_RATIO;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? DEFAULT_SPLIT_RATIO : clampSplitRatio(Number.parseFloat(raw));
  } catch {
    return DEFAULT_SPLIT_RATIO;
  }
}

function storeRatio(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value.toFixed(4));
  } catch {
    return;
  }
}

export interface SplitPaneProps {
  readonly storageKey: string;
  readonly label: string;
  readonly first: ReactNode | null;
  readonly second: ReactNode | null;
  readonly firstClassName?: string;
  readonly secondClassName?: string;
}

export function SplitPane({
  storageKey,
  label,
  first,
  second,
  firstClassName,
  secondClassName,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(DEFAULT_SPLIT_RATIO);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const paneId = useId();

  useEffect(() => {
    setRatio(readStoredRatio(storageKey));
  }, [storageKey]);

  const commit = (next: number) => {
    setRatio(next);
    storeRatio(storageKey, next);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = container.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.width === 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    let next = ratio;
    const onMove = (moveEvent: PointerEvent) => {
      next = clampSplitRatio((moveEvent.clientX - bounds.left) / bounds.width);
      setRatio(next);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      setDragging(false);
      commit(next);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      commit(MIN_SPLIT_RATIO);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      commit(MAX_SPLIT_RATIO);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    commit(clampSplitRatio(ratio + (event.key === 'ArrowLeft' ? -KEYBOARD_STEP : KEYBOARD_STEP)));
  };

  if (first === null || second === null) {
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden" data-testid="split-pane">
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 overflow-hidden',
            first === null ? secondClassName : firstClassName,
          )}
        >
          {first ?? second}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={container}
      className={cn('flex min-h-0 flex-1 overflow-hidden', dragging ? 'select-none' : null)}
      data-testid="split-pane"
    >
      <div
        id={`${paneId}-first`}
        style={{ flexBasis: `${ratio * 100}%` }}
        className={cn('min-h-0 min-w-0 shrink-0 grow-0 overflow-hidden', firstClassName)}
      >
        {first}
      </div>
      <hr
        tabIndex={0}
        aria-controls={`${paneId}-first ${paneId}-second`}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(MIN_SPLIT_RATIO * 100)}
        aria-valuemax={Math.round(MAX_SPLIT_RATIO * 100)}
        data-testid="split-pane-handle"
        onPointerDown={startResize}
        onKeyDown={nudge}
        onDoubleClick={() => commit(DEFAULT_SPLIT_RATIO)}
        className={cn(
          'm-0 h-auto w-1 shrink-0 cursor-col-resize touch-none self-stretch border-0 bg-border',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
          'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
          dragging ? 'bg-accent' : null,
        )}
      />
      <div
        id={`${paneId}-second`}
        className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', secondClassName)}
      >
        {second}
      </div>
    </div>
  );
}
