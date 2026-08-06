import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, render } from '@testing-library/react';

let search = '';

mock.module('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/team/eng/issues',
  useSearchParams: () => new URLSearchParams(search),
}));

const { URL_SYNC_DELAY_MS, useViewConfig } = await import(
  '../../../src/features/filters/use-view-config.ts'
);

type Ordering = 'manual' | 'priority' | 'created' | 'updated';

interface Captured {
  readonly orderBy: string;
  readonly setOrderBy: (value: Ordering) => void;
}

let captured: Captured | null = null;

function Harness() {
  const { config, setConfig } = useViewConfig('team_1', 'list', 'team');
  captured = {
    orderBy: config.orderBy,
    setOrderBy: (value) => setConfig({ ...config, orderBy: value }),
  };
  return null;
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function urlSearch(): string {
  return window.location.search.replace(/^\?/, '');
}

function setUrl(next: string): void {
  search = next;
  const target = next === '' ? '/team/eng/issues' : `/team/eng/issues?${next}`;
  window.history.replaceState(null, '', target);
}

describe('useViewConfig url sync', () => {
  beforeEach(() => {
    setUrl('');
    captured = null;
    window.localStorage.clear();
  });

  it('applies a change immediately without waiting for a navigation', () => {
    render(<Harness />);
    expect(captured?.orderBy).toBe('manual');

    act(() => captured?.setOrderBy('priority'));

    expect(captured?.orderBy).toBe('priority');
    expect(urlSearch()).toBe('');
  });

  it('collapses a burst of changes into a single url write', async () => {
    render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    act(() => captured?.setOrderBy('created'));
    act(() => captured?.setOrderBy('updated'));
    expect(urlSearch()).toBe('');

    await wait(URL_SYNC_DELAY_MS + 80);

    expect(urlSearch()).toContain('order=updated');
    expect(captured?.orderBy).toBe('updated');
  });

  it('keeps an edit made while the previous write is still in flight', async () => {
    const { rerender } = render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    await wait(URL_SYNC_DELAY_MS + 80);
    expect(urlSearch()).toContain('order=priority');

    act(() => captured?.setOrderBy('created'));
    search = 'order=priority';
    act(() => rerender(<Harness />));
    expect(captured?.orderBy).toBe('created');

    await wait(URL_SYNC_DELAY_MS + 80);

    expect(captured?.orderBy).toBe('created');
    expect(urlSearch()).toContain('order=created');
  });

  it('flushes a pending edit when the view unmounts', () => {
    const { unmount } = render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    expect(urlSearch()).toBe('');

    act(() => unmount());

    expect(urlSearch()).toContain('order=priority');
  });

  it('lets a url the hook did not request win and cancels the pending write', async () => {
    const { rerender } = render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    setUrl('order=created');
    act(() => rerender(<Harness />));

    expect(captured?.orderBy).toBe('created');
    await wait(URL_SYNC_DELAY_MS + 80);
    expect(urlSearch()).toContain('order=created');
  });

  it('carries the saved view parameter through every write', async () => {
    setUrl('view=view_1');
    render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    await wait(URL_SYNC_DELAY_MS + 80);

    expect(urlSearch()).toContain('view=view_1');
    expect(urlSearch()).toContain('order=priority');
  });

  it('writes nothing when the config already matches the url', async () => {
    setUrl('order=priority');
    render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    await wait(URL_SYNC_DELAY_MS + 80);

    expect(urlSearch()).toBe('order=priority');
  });
});
