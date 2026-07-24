import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { TopBar } from './top-bar.tsx';

describe('TopBar', () => {
  it('does not render a Display menu, that control lives in the view header', () => {
    render(
      <TooltipProvider>
        <TopBar
          breadcrumbs={[{ label: 'Engineering' }]}
          onOpenDrawer={mock()}
          panelOpen={null}
          onTogglePanel={mock()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.queryByLabelText('Display options')).toBeNull();
    expect(screen.queryByTestId('display-menu-trigger')).toBeNull();
  });
});
