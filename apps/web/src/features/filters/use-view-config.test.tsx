import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, render } from '@testing-library/react';

const replaced: string[] = [];
let search = '';

mock.module('next/navigation', () => ({
  useRouter: () => ({
    replace: (url: string) => {
      replaced.push(url);
    },
    push: () => undefined,
  }),
  usePathname: () => '/team/eng/issues',
  useSearchParams: () => new URLSearchParams(search),
}));

const { URL_SYNC_DELAY_MS, useViewConfig } = await import('./use-view-config.ts');

interface Captured {
  readonly orderBy: string;
  readonly setOrderBy: (value: 'manual' | 'priority' | 'created') => void;
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

describe('useViewConfig url sync', () => {
  beforeEach(() => {
    replaced.length = 0;
    search = '';
    captured = null;
    window.localStorage.clear();
  });

  it('applies a change immediately without waiting for a navigation', () => {
    render(<Harness />);
    expect(captured?.orderBy).toBe('manual');

    act(() => captured?.setOrderBy('priority'));

    expect(captured?.orderBy).toBe('priority');
    expect(replaced).toHaveLength(0);
  });

  it('collapses a burst of changes into a single navigation', async () => {
    render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    act(() => captured?.setOrderBy('created'));
    act(() => captured?.setOrderBy('manual'));
    expect(replaced).toHaveLength(0);

    await wait(URL_SYNC_DELAY_MS + 60);

    expect(replaced).toHaveLength(1);
    expect(captured?.orderBy).toBe('manual');
  });

  it('writes the final state into the url so the view stays shareable', async () => {
    render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    await wait(URL_SYNC_DELAY_MS + 60);

    expect(replaced[0]).toContain('/team/eng/issues');
    expect(replaced[0]).toContain('order=priority');
  });

  it('lets the url win when the browser navigates during the debounce', async () => {
    const { rerender } = render(<Harness />);

    act(() => captured?.setOrderBy('priority'));
    search = 'order=created';
    act(() => rerender(<Harness />));

    await wait(URL_SYNC_DELAY_MS + 60);

    expect(captured?.orderBy).toBe('created');
    expect(replaced).toHaveLength(0);
  });
});
