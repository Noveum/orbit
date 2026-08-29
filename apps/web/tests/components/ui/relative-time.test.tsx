import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { relativeTime } from '@orbit/shared/utils';
import { act, render, screen } from '@testing-library/react';
import { Glob } from 'bun';
import type { ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { RelativeTime } from '../../../src/components/ui/relative-time.tsx';

const SERVER_NOW = new Date('2026-05-01T12:00:00.000Z');
const CLIENT_NOW = new Date('2026-05-01T12:00:10.000Z');
const LAST_SEEN = '2026-05-01T11:59:20.000Z';

function UnguardedRelativeTime({ at }: { readonly at: string }) {
  return <span>{relativeTime(new Date(at))}</span>;
}

function hydrationComplaints(node: ReactElement): string[] {
  setSystemTime(SERVER_NOW);
  const html = renderToString(node);
  setSystemTime(CLIENT_NOW);

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);

  const complaints: string[] = [];
  const reportedError = console.error;
  console.error = (...args: unknown[]) => {
    complaints.push(args.map(String).join(' '));
  };
  let root: Root | undefined;
  try {
    act(() => {
      root = hydrateRoot(container, node, {
        onRecoverableError: (error) => {
          complaints.push(String(error));
        },
      });
    });
  } finally {
    console.error = reportedError;
  }
  act(() => root?.unmount());
  container.remove();
  return complaints.filter((line) => line.toLowerCase().includes('hydrat'));
}

describe('RelativeTime', () => {
  afterEach(() => {
    setSystemTime();
  });

  it('spans a relativeTime boundary between the server render and hydration', () => {
    setSystemTime(SERVER_NOW);
    expect(relativeTime(new Date(LAST_SEEN))).toBe('just now');
    setSystemTime(CLIENT_NOW);
    expect(relativeTime(new Date(LAST_SEEN))).toBe('1m ago');
  });

  it('hydrates cleanly when the client clock has crossed that boundary', () => {
    expect(hydrationComplaints(<RelativeTime at={LAST_SEEN} />)).toEqual([]);
  });

  it('reports a mismatch when the same timestamp is rendered without it', () => {
    expect(hydrationComplaints(<UnguardedRelativeTime at={LAST_SEEN} />).length).toBeGreaterThan(0);
  });

  it('carries the machine readable timestamp', () => {
    setSystemTime(SERVER_NOW);
    render(<RelativeTime at={LAST_SEEN} />);
    const stamp = screen.getByText('just now');
    expect(stamp.tagName).toBe('TIME');
    expect(stamp).toHaveAttribute('datetime', LAST_SEEN);
  });
});

describe('relative timestamps across apps/web', () => {
  it('are rendered through RelativeTime and never inline', async () => {
    const sourceRoot = `${import.meta.dir}/../../../src/`;
    const offenders: string[] = [];
    let scanned = 0;
    for await (const relative of new Glob('**/*.{ts,tsx}').scan(sourceRoot)) {
      scanned += 1;
      if (relative.replaceAll('\\', '/') === 'components/ui/relative-time.tsx') continue;
      const source = await Bun.file(`${sourceRoot}${relative}`).text();
      if (source.includes('relativeTime(')) offenders.push(relative);
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
