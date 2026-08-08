import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from '@/components/layout/top-bar.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

afterEach(cleanup);

function bar(onOpenSearch = mock()) {
  render(
    <TooltipProvider>
      <TopBar
        breadcrumbs={[{ label: 'Noveum' }, { label: 'Standup' }]}
        onOpenDrawer={() => undefined}
        onOpenSearch={onOpenSearch}
        panelOpen={null}
        onTogglePanel={() => undefined}
      />
    </TooltipProvider>,
  );
  return onOpenSearch;
}

describe('the search box in the top bar', () => {
  it('sits in the bar on every surface, not only behind a shortcut', () => {
    bar();

    expect(screen.getByTestId('top-bar-search')).toBeInTheDocument();
  });

  it('opens the same palette the keyboard shortcut opens', async () => {
    const user = userEvent.setup();
    const onOpenSearch = bar();

    await user.click(screen.getByTestId('top-bar-search'));

    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('advertises the shortcut so the keyboard route stays discoverable', () => {
    bar();

    const search = screen.getByTestId('top-bar-search');
    expect(search.getAttribute('aria-keyshortcuts')).toContain('K');
    expect(search.textContent).toContain('Search');
  });

  it('keeps a reachable control on a narrow screen', async () => {
    const user = userEvent.setup();
    const onOpenSearch = bar();

    await user.click(screen.getByTestId('top-bar-search-compact'));

    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });
});
