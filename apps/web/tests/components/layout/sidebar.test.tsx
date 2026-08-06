import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { buildSidebarNav, type ShellTeam } from '@/lib/navigation.ts';
import { Sidebar } from '../../../src/components/layout/sidebar.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), refresh: mock() }),
  usePathname: () => '/team/eng/issues',
}));

mock.module('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: mock() }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    organization: { setActive: mock() },
    signOut: mock(() => Promise.resolve()),
  },
}));

const TEAMS: readonly ShellTeam[] = [
  { id: 'team-eng', key: 'ENG', name: 'Engineering', color: '#5A63C8', openIssues: 4 },
  { id: 'team-mkt', key: 'MKT', name: 'Marketing', color: '#22A06B' },
];

const noop = () => undefined;

function renderSidebar() {
  return render(
    <TooltipProvider>
      <Sidebar
        workspace={{ id: 'org-1', name: 'Noveum', slug: 'noveum' }}
        workspaces={[]}
        user={{ name: 'Pulkit', email: 'pulkit@noveum.ai', image: null }}
        nav={buildSidebarNav(TEAMS, 2)}
        collapsed={false}
        onToggleCollapsed={noop}
        onOpenPalette={noop}
      />
    </TooltipProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('auto-expands the team matching the current route and collapses the others', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: /Engineering/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /Marketing/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('reveals a team subtree when its row is clicked', () => {
    renderSidebar();

    expect(screen.getAllByRole('link', { name: 'Board' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Marketing/ }));

    expect(screen.getByRole('button', { name: /Marketing/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByRole('link', { name: 'Board' })).toHaveLength(2);
  });

  it('collapses a section group from its header', () => {
    renderSidebar();

    const header = screen.getByRole('button', { name: 'Workspace' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Projects/ })).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });
});
