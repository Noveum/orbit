'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUpRight, X } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react';
import { cn } from '@/lib/cn.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { IssueDetailView } from './issue-detail.tsx';

const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 640;
const KEYBOARD_STEP = 24;
const WIDTH_STORAGE_KEY = 'orbit:peek-width';

function maxWidth(): number {
  if (typeof window === 'undefined') return 900;
  return Math.min(window.innerWidth * 0.9, 900);
}

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(value, maxWidth()));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return clampWidth(Number.isNaN(parsed) ? DEFAULT_WIDTH : parsed);
}

function storeWidth(value: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(value)));
}

export interface IssuePeekProps {
  readonly issue: Issue | undefined;
  readonly onClose: () => void;
  readonly onOpen: () => void;
}

export function IssuePeek({ issue, onClose, onOpen }: IssuePeekProps) {
  const [width, setWidth] = useState(readStoredWidth);

  if (issue === undefined) return null;

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let next = width;
    const onMove = (moveEvent: PointerEvent) => {
      next = clampWidth(window.innerWidth - moveEvent.clientX);
      setWidth(next);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      storeWidth(next);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const nudge = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = clampWidth(width + (event.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP));
    setWidth(next);
    storeWidth(next);
  };

  return (
    <DialogPrimitive.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-testid="issue-peek"
          aria-label={`Peek ${issue.identifier}`}
          style={{ width }}
          onInteractOutside={(event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('[data-testid^="issue-row-"], [data-testid^="issue-card-"]')) {
              event.preventDefault();
            }
          }}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex max-w-[90vw] flex-col border-border border-l bg-surface shadow-pop',
            'data-[state=open]:animate-panel-in data-[state=closed]:animate-panel-out',
            'motion-reduce:animate-none',
          )}
        >
          <div className="flex items-center justify-between border-border border-b px-3 py-2">
            <span data-numeric className="text-2xs text-faint">
              {issue.identifier}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpen}
                aria-label="Open full page"
                className="flex items-center gap-1 rounded-sm px-2 py-1 text-2xs text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text"
              >
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                Open
              </button>
              <DialogPrimitive.Close
                aria-label="Close"
                className="rounded-sm p-1 text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text"
              >
                <X className="size-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <DialogPrimitive.Title className="sr-only">{issue.title}</DialogPrimitive.Title>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IssueDetailView identifier={issue.identifier} />
          </div>
          <button
            type="button"
            aria-label="Resize panel"
            onPointerDown={startResize}
            onKeyDown={nudge}
            className={cn(
              'absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize touch-none bg-transparent',
              'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
              'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
            )}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
