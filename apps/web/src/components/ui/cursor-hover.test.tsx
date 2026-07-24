import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { Glob } from 'bun';
import { cardHover, revealOnHover, rowHover } from '@/lib/interaction.ts';
import { Button } from './button.tsx';
import { Checkbox } from './checkbox.tsx';
import { Input } from './input.tsx';
import { Switch } from './switch.tsx';
import { Textarea } from './textarea.tsx';

const sourceRoot = `${import.meta.dir}/../../`;
const css = await Bun.file(`${sourceRoot}app/globals.css`).text();

function baseBlockFor(declaration: string): string {
  const index = css.indexOf(declaration);
  expect(index).toBeGreaterThan(-1);
  const start = css.lastIndexOf('}', index) + 1;
  return css.slice(start, index);
}

async function sourceFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const relative of new Glob('**/*.tsx').scan(sourceRoot)) {
    if (relative.endsWith('.test.tsx')) continue;
    files.set(relative, await Bun.file(`${sourceRoot}${relative}`).text());
  }
  return files;
}

const sources = await sourceFiles();

describe('cursor contract', () => {
  it('gives every clickable role a pointer in the base layer', () => {
    const selectors = baseBlockFor('cursor: pointer;');
    for (const selector of [
      'a[href]',
      'button',
      'summary',
      'label[for]',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[role="radio"]',
    ]) {
      expect(selectors).toContain(selector);
    }
  });

  it('gives every disabled affordance a not-allowed cursor in the base layer', () => {
    const selectors = baseBlockFor('cursor: not-allowed;');
    expect(selectors).toContain(':disabled');
    expect(selectors).toContain('[aria-disabled="true"]');
    expect(selectors).toContain('[data-disabled]');
  });

  it('never neutralises a pointer with cursor-default', () => {
    const offenders = [...sources]
      .filter(([, source]) => source.includes('cursor-default'))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('pairs every dimmed disabled style with a not-allowed cursor', () => {
    const offenders = [...sources]
      .filter(
        ([, source]) =>
          source.includes('disabled:opacity-50') && !source.includes('disabled:cursor-not-allowed'),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('never hides a disabled control from the pointer, which would hide its cursor', () => {
    const offenders = [...sources]
      .filter(
        ([, source]) =>
          source.includes('disabled:pointer-events-none') ||
          source.includes('data-[disabled]:pointer-events-none'),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe('Button', () => {
  it('is a pointer when enabled and not-allowed when disabled', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('cursor-pointer');
    expect(button).toHaveClass('disabled:cursor-not-allowed');
    expect(button).toHaveClass('aria-disabled:cursor-not-allowed');
  });

  it('gates every hover and press affordance behind the enabled state', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      const { container, unmount } = render(<Button variant={variant}>Act</Button>);
      const classes = container.firstElementChild?.className ?? '';
      const hovers = classes.split(' ').filter((entry) => entry.includes('hover:'));
      expect(hovers.length).toBeGreaterThan(0);
      for (const hover of hovers) {
        expect(hover.startsWith('not-disabled:')).toBe(true);
      }
      expect(classes).toContain('not-disabled:active:scale-');
      unmount();
    }
  });
});

describe('form controls', () => {
  it('marks the checkbox as clickable, hoverable, and blocked when disabled', () => {
    render(<Checkbox aria-label="Select row" />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toHaveClass('cursor-pointer');
    expect(checkbox).toHaveClass('not-disabled:hover:border-accent');
    expect(checkbox).toHaveClass('disabled:cursor-not-allowed');
  });

  it('marks the switch the same way', () => {
    render(<Switch aria-label="Share view" />);
    const control = screen.getByRole('switch');
    expect(control).toHaveClass('cursor-pointer');
    expect(control).toHaveClass('not-disabled:hover:border-border-strong');
    expect(control).toHaveClass('disabled:cursor-not-allowed');
  });

  it('drops the input hover cue while disabled', () => {
    const { container } = render(<Input disabled aria-label="Name" />);
    const classes = container.firstElementChild?.className ?? '';
    expect(classes).toContain('not-disabled:hover:border-border-strong');
    expect(classes).toContain('disabled:cursor-not-allowed');
  });

  it('drops the textarea hover cue while disabled', () => {
    const { container } = render(<Textarea disabled aria-label="Body" />);
    const classes = container.firstElementChild?.className ?? '';
    expect(classes).toContain('not-disabled:hover:border-border-strong');
    expect(classes).toContain('disabled:cursor-not-allowed');
  });
});

describe('hover reveal', () => {
  it('starts hidden and appears under the pointer, under focus, and on touch', () => {
    expect(revealOnHover).toContain('opacity-0');
    expect(revealOnHover).toContain('group-hover:opacity-100');
    expect(revealOnHover).toContain('group-focus-within:opacity-100');
    expect(revealOnHover).toContain('focus-visible:opacity-100');
    expect(revealOnHover).toContain('data-[state=open]:opacity-100');
    expect(revealOnHover).toContain('[@media(hover:none)]:opacity-100');
  });

  it('fades with opacity only, inside the motion budget', () => {
    expect(revealOnHover).toContain('transition-opacity');
    expect(revealOnHover).toContain('duration-[var(--duration-fast)]');
    expect(revealOnHover).not.toContain('transition-all');
  });

  it('pairs every reveal with a group ancestor in the same file', () => {
    const offenders = [...sources]
      .filter(([, source]) => source.includes('revealOnHover') && !/['" ]group[ '"]/.test(source))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe('row and card hover', () => {
  it('tints a row on hover and transitions colour only', () => {
    expect(rowHover).toContain('hover:bg-hover');
    expect(rowHover).toContain('transition-colors');
  });

  it('lifts a card border and surface on hover', () => {
    expect(cardHover).toContain('hover:border-border-strong');
    expect(cardHover).toContain('hover:bg-surface-2');
  });
});
