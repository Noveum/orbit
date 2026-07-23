import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellWorkspace } from '@/lib/navigation.ts';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

const push = vi.fn();
const refresh = vi.fn();
const setActive = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: vi.fn() }),
}));

vi.mock('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/lib/auth/client.ts', () => ({
  authClient: {
    organization: { setActive: (...args: unknown[]) => setActive(...args) },
    signOut: vi.fn(() => Promise.resolve()),
  },
}));

const NOVEUM: ShellWorkspace = { id: 'org-1', name: 'Noveum', slug: 'noveum' };
const COMET: ShellWorkspace = { id: 'org-2', name: 'Comet', slug: 'comet' };
const USER = { name: 'Pulkit Sharma', email: 'pulkit@noveum.ai', image: null };

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  setActive.mockReset();
});

async function openMenu(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('workspace-switcher'));
  await screen.findByText('Workspaces');
}

describe('WorkspaceSwitcher', () => {
  it('lists every workspace the member belongs to and marks the active one', async () => {
    render(
      <WorkspaceSwitcher
        workspace={NOVEUM}
        workspaces={[NOVEUM, COMET]}
        user={USER}
        collapsed={false}
      />,
    );
    await openMenu();

    expect(screen.getByTestId('workspace-option-noveum')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('workspace-option-comet')).not.toHaveAttribute('aria-current');
  });

  it('never lists a workspace the member does not belong to', async () => {
    render(
      <WorkspaceSwitcher workspace={NOVEUM} workspaces={[NOVEUM]} user={USER} collapsed={false} />,
    );
    await openMenu();

    expect(screen.getByTestId('workspace-option-noveum')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-option-comet')).toBeNull();
    expect(screen.getByTestId('create-workspace')).toBeInTheDocument();
  });

  it('sets the active organization and lands on that workspace when switching', async () => {
    setActive.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(
      <WorkspaceSwitcher
        workspace={NOVEUM}
        workspaces={[NOVEUM, COMET]}
        user={USER}
        collapsed={false}
      />,
    );
    await openMenu();

    await user.click(screen.getByTestId('workspace-option-comet'));

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith({ organizationId: 'org-2' });
    });
    expect(push).toHaveBeenCalledWith('/my-issues');
    expect(refresh).toHaveBeenCalled();
  });

  it('does not switch when the active workspace is picked again', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSwitcher
        workspace={NOVEUM}
        workspaces={[NOVEUM, COMET]}
        user={USER}
        collapsed={false}
      />,
    );
    await openMenu();

    await user.click(screen.getByTestId('workspace-option-noveum'));

    expect(setActive).not.toHaveBeenCalled();
  });

  it('routes to the create workspace page', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSwitcher
        workspace={NOVEUM}
        workspaces={[NOVEUM, COMET]}
        user={USER}
        collapsed={false}
      />,
    );
    await openMenu();

    await user.click(screen.getByTestId('create-workspace'));

    expect(push).toHaveBeenCalledWith('/workspaces/new');
  });
});
