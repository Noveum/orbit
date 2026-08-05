import { describe, expect, it } from 'bun:test';
import type { RealtimeStatus } from '@orbit/realtime-client';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  ConnectionBannerView,
  RECONNECT_GRACE_MS,
} from '../../../src/lib/realtime/connection-banner.tsx';

function renderAt(status: RealtimeStatus): void {
  render(<ConnectionBannerView status={status} />);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('ConnectionBannerView', () => {
  it('stays hidden while the connection is healthy', () => {
    renderAt('open');
    expect(screen.queryByTestId('realtime-connection-banner')).toBeNull();
    cleanup();
  });

  it('does not flash during a reconnect that resolves inside the grace window', async () => {
    renderAt('reconnecting');
    expect(screen.queryByTestId('realtime-connection-banner')).toBeNull();
    await advance(RECONNECT_GRACE_MS / 2);
    expect(screen.queryByTestId('realtime-connection-banner')).toBeNull();
    cleanup();
  });

  it('surfaces a reconnect that outlasts the grace window', async () => {
    renderAt('reconnecting');
    await advance(RECONNECT_GRACE_MS + 50);
    expect(screen.getByTestId('realtime-connection-banner').textContent).toContain('Reconnecting');
    cleanup();
  });

  it('reports a terminal close immediately, with no grace period', () => {
    renderAt('closed');
    expect(screen.getByTestId('realtime-connection-banner').textContent).toContain(
      'no longer valid',
    );
    cleanup();
  });
});
