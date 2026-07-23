import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HiddenFooter } from './hidden-footer.tsx';

describe('HiddenFooter', () => {
  it('renders nothing when nothing is hidden', () => {
    render(
      <HiddenFooter
        hiddenByFilters={0}
        hiddenByDisplay={0}
        onClearFilters={() => undefined}
        onRevealDisplay={() => undefined}
      />,
    );
    expect(screen.queryByTestId('hidden-footer')).toBeNull();
  });

  it('names the filtered count and clears them inline', async () => {
    const user = userEvent.setup();
    const onClearFilters = mock();
    render(
      <HiddenFooter
        hiddenByFilters={109}
        hiddenByDisplay={0}
        onClearFilters={onClearFilters}
        onRevealDisplay={() => undefined}
      />,
    );

    expect(screen.getByTestId('hidden-by-filters')).toHaveTextContent('109 issues');
    expect(screen.getByTestId('hidden-by-filters')).toHaveTextContent('hidden by filters');
    expect(screen.queryByTestId('hidden-by-display')).toBeNull();

    await user.click(screen.getByTestId('footer-clear-filters'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('names the display count and reveals them inline', async () => {
    const user = userEvent.setup();
    const onRevealDisplay = mock();
    render(
      <HiddenFooter
        hiddenByFilters={0}
        hiddenByDisplay={51}
        onClearFilters={() => undefined}
        onRevealDisplay={onRevealDisplay}
      />,
    );

    expect(screen.getByTestId('hidden-by-display')).toHaveTextContent('51 issues');
    expect(screen.getByTestId('hidden-by-display')).toHaveTextContent('hidden by display options');

    await user.click(screen.getByTestId('footer-reveal-display'));
    expect(onRevealDisplay).toHaveBeenCalledTimes(1);
  });

  it('says issue in the singular', () => {
    render(
      <HiddenFooter
        hiddenByFilters={1}
        hiddenByDisplay={1}
        onClearFilters={() => undefined}
        onRevealDisplay={() => undefined}
      />,
    );
    expect(screen.getByTestId('hidden-by-filters')).toHaveTextContent('1 issue');
    expect(screen.getByTestId('hidden-by-display')).toHaveTextContent('1 issue');
  });
});
