import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { ShellTeam, ShellUser, ShellWorkspace } from '@/lib/navigation.ts';
import { AppShell } from './app-shell.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), refresh: mock() }),
  usePathname: () => '/inbox',
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

const WORKSPACE: ShellWorkspace = { id: 'org-1', name: 'Noveum', slug: 'noveum' };
const USER: ShellUser = { name: 'Pulkit Sharma', email: 'pulkit@noveum.ai', image: null };
const TEAMS: readonly ShellTeam[] = [{ id: 'team-1', key: 'NOV', name: 'Noveum' }];

function renderShell(panel?: ReactNode) {
  return render(
    <TooltipProvider>
      <HotkeyProvider>
        <AppShell
          workspace={WORKSPACE}
          workspaces={[WORKSPACE]}
          user={USER}
          teams={TEAMS}
          breadcrumbs={[{ label: 'Noveum' }, { label: 'Inbox' }]}
          {...(panel === undefined ? {} : { panel })}
        >
          <p>Body</p>
        </AppShell>
      </HotkeyProvider>
    </TooltipProvider>,
  );
}

describe('AppShell', () => {
  it('opens the navigation drawer from the trigger when the viewport is narrow', () => {
    renderShell();
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('toggles the same drawer with the sidebar shortcut', () => {
    renderShell();

    fireEvent.keyDown(document.body, { key: '[' });
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: '[' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('closes the drawer when a navigation link is followed', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    fireEvent.click(within(drawer).getByRole('link', { name: /My issues/ }));

    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('has no right panel affordance when no panel is supplied', () => {
    renderShell();

    expect(screen.queryByRole('button', { name: 'Toggle right panel' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
  });

  it('toggles the right panel from the top bar and from the keyboard', () => {
    renderShell(<p>Properties</p>);

    const toggle = screen.getByRole('button', { name: 'Toggle right panel' });
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(document.body, { key: ']' });
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
  });
});
