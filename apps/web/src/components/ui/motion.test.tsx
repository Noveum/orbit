import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { Button } from './button.tsx';
import { Dialog, DialogContent, DialogTitle } from './dialog.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from './dropdown-menu.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx';
import { TOOLTIP_DELAY_MS, TOOLTIP_DESCRIPTION_DELAY_MS } from './tooltip.tsx';

const css = await Bun.file(new URL('../../app/globals.css', import.meta.url)).text();

const LAYOUT_PROPERTIES = [
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'padding',
  'inset',
];

function keyframeBlocks(): Map<string, string> {
  const blocks = new Map<string, string>();
  const pattern = /@keyframes\s+([a-z-]+)\s*\{([\s\S]*?)\n\}/g;
  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    const body = match[2];
    if (name !== undefined && body !== undefined) blocks.set(name, body);
  }
  return blocks;
}

describe('motion tokens', () => {
  it('animates opacity and transform only, never a layout property', () => {
    const offenders: string[] = [];
    for (const [name, body] of keyframeBlocks()) {
      for (const line of body.split('\n')) {
        const property = /^\s*([a-z-]+)\s*:/.exec(line)?.[1];
        if (property === undefined) continue;
        if (property !== 'opacity' && property !== 'transform')
          offenders.push(`${name}.${property}`);
        if (LAYOUT_PROPERTIES.includes(property)) offenders.push(`${name}.${property}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every named animation inside the duration budget', () => {
    const named = [...css.matchAll(/--animate-([a-z-]+):\s*([^;]+);/g)];
    expect(named.length).toBeGreaterThan(5);
    for (const [, name, value] of named) {
      if (name === 'shimmer') continue;
      expect(value).toContain('var(--duration-');
    }
  });

  it('holds the dialog centred through its entry and exit', () => {
    const blocks = keyframeBlocks();
    for (const name of ['dialog-in', 'dialog-out'] as const) {
      const body = blocks.get(name) ?? '';
      expect(body).toContain('translate(-50%, -50%)');
      expect(body.match(/translate\(-50%, -50%\)/g)).toHaveLength(2);
    }
  });

  it('neutralises motion when the viewer asks for less of it', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation-duration: 0.01ms !important');
    expect(reduced).toContain('transition-duration: 0.01ms !important');
    expect(reduced).toContain('scroll-behavior: auto !important');
  });

  it('rings focus from the token and never from the browser default', () => {
    expect(css).toContain('outline: var(--orbit-ring-width) solid var(--color-ring)');
    expect(css).toMatch(/:focus:not\(:focus-visible\)\s*\{\s*outline: none;/);
  });
});

describe('overlay entry and exit', () => {
  it('scales a popover from its anchor edge and shrinks it back on dismiss', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="ghost">Filter</Button>
        </PopoverTrigger>
        <PopoverContent>
          <span>Status</span>
        </PopoverContent>
      </Popover>,
    );

    const content = screen.getByText('Status').parentElement;
    expect(content?.className).toContain('origin-[var(--radix-popover-content-transform-origin)]');
    expect(content?.className).toContain('data-[state=open]:animate-pop-in');
    expect(content?.className).toContain('data-[state=closed]:animate-pop-out');
  });

  it('holds the trigger fill for as long as the popover is open', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="ghost">Filter</Button>
        </PopoverTrigger>
        <PopoverContent>
          <span>Status</span>
        </PopoverContent>
      </Popover>,
    );

    const trigger = screen.getByRole('button', { name: 'Filter' });
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(trigger.className).toContain('data-[state=open]:bg-surface-2');
  });

  it('scales a dropdown menu from its anchor edge', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const content = screen.getByRole('menu');
    expect(content.className).toContain(
      'origin-[var(--radix-dropdown-menu-content-transform-origin)]',
    );
    expect(content.className).toContain('data-[state=open]:animate-pop-in');
  });

  it('animates a dialog without dropping its centring transform', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>New issue</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByRole('dialog');
    expect(content.className).toContain('data-[state=open]:animate-dialog-in');
    expect(content.className).toContain('data-[state=closed]:animate-dialog-out');
    expect(content.className).toContain('-translate-x-1/2');
  });
});

describe('tooltip timing', () => {
  it('waits 300ms for a pointer tooltip and 500ms for a descriptive one', () => {
    expect(TOOLTIP_DELAY_MS).toBe(300);
    expect(TOOLTIP_DESCRIPTION_DELAY_MS).toBe(500);
  });
});
