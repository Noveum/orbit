'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn.ts';

const KEY_GLYPHS: Record<string, string> = {
  mod: '⌘',
  cmd: '⌘',
  meta: '⌘',
  ctrl: 'Ctrl',
  alt: '⌥',
  shift: '⇧',
  enter: '↵',
  escape: 'Esc',
  esc: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: '⌫',
  space: 'Space',
};

export function keyGlyph(key: string): string {
  return KEY_GLYPHS[key.toLowerCase()] ?? key.toUpperCase();
}

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  readonly keys: readonly string[];
}

export function Kbd({ keys, className, ...props }: KbdProps) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} {...props}>
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-xs border border-border bg-surface-2 px-1 font-mono text-2xs text-muted leading-none"
        >
          {keyGlyph(key)}
        </kbd>
      ))}
    </span>
  );
}
