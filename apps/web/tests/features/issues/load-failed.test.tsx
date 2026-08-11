import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LoadFailed } from '../../../src/features/issues/load-failed.tsx';

afterEach(cleanup);

describe('the state a surface shows when its request failed', () => {
  it('names what could not be read rather than claiming it is empty', () => {
    const retry = mock(() => undefined);
    render(<LoadFailed subject="this sprint" onRetry={retry} testId="retry-x" />);

    expect(screen.getByText('Could not load this sprint')).toBeDefined();
    expect(screen.queryByText(/Nothing/)).toBeNull();
  });

  it('says plainly that unread is not the same as empty', () => {
    const retry = mock(() => undefined);
    render(<LoadFailed subject="your issues" onRetry={retry} testId="retry-x" />);

    expect(screen.getByText(/it is unread/)).toBeDefined();
  });

  it('offers a retry that actually calls back', () => {
    const retry = mock(() => undefined);
    render(<LoadFailed subject="the board" onRetry={retry} testId="retry-board" />);

    fireEvent.click(screen.getByTestId('retry-board'));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
