import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher.tsx';
import type { ShellWorkspace } from '@/lib/navigation.ts';

const push = mock();
const refresh = mock();
const setActive = mock();
const assign = mock();
const realLocation = window.location;

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

mock.module('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: mock() }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    organization: { setActive: (...args: unknown[]) => setActive(...args) },
    signOut: mock(() => Promise.resolve()),
  },
}));

const NOVEUM: ShellWorkspace = { id: 'org-1', name: 'Noveum', slug: 'noveum' };
const COMET: ShellWorkspace = { id: 'org-2', name: 'Comet', slug: 'comet' };
const USER = { name: 'Pulkit Sharma', email: 'pulkit@noveum.ai', image: null };

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  setActive.mockReset();
  assign.mockClear();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, writable: true });
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
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/my-issues');
    });
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

  it('routes to settings from a single menu entry', async () => {
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

    expect(screen.queryByText('Account settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace settings')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('settings-link'));

    expect(push).toHaveBeenCalledWith('/settings/general');
  });

  it('routes to the MCP server page, so connecting a client is one click from the menu', async () => {
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

    await user.click(screen.getByTestId('mcp-link'));

    expect(push).toHaveBeenCalledWith('/settings/mcp');
  });

  it('renders the workspace logo in the switcher trigger when configured', () => {
    const workspaceWithLogo: ShellWorkspace = {
      ...NOVEUM,
      logo: 'https://example.com/noveum.png',
    };
    render(
      <WorkspaceSwitcher
        workspace={workspaceWithLogo}
        workspaces={[workspaceWithLogo, COMET]}
        user={USER}
        collapsed={false}
      />,
    );

    const trigger = screen.getByTestId('workspace-switcher');
    const img = trigger.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/noveum.png');
    expect(img).toHaveAttribute('alt', 'Noveum');
  });

  it('falls back to the text initial in the switcher trigger when logo fails to load', () => {
    const workspaceWithBrokenLogo: ShellWorkspace = {
      ...NOVEUM,
      logo: 'https://example.com/broken.png',
    };
    render(
      <WorkspaceSwitcher
        workspace={workspaceWithBrokenLogo}
        workspaces={[workspaceWithBrokenLogo, COMET]}
        user={USER}
        collapsed={false}
      />,
    );

    const trigger = screen.getByTestId('workspace-switcher');
    const img = trigger.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as Element);

    expect(trigger.querySelector('img')).toBeNull();
    expect(trigger).toHaveTextContent('N');
  });

  it('renders logos for workspaces in the switcher dropdown menu', async () => {
    const workspaceWithLogo: ShellWorkspace = {
      ...NOVEUM,
      logo: 'https://example.com/noveum.png',
    };
    const cometWithLogo: ShellWorkspace = {
      ...COMET,
      logo: 'https://example.com/comet.png',
    };
    render(
      <WorkspaceSwitcher
        workspace={workspaceWithLogo}
        workspaces={[workspaceWithLogo, cometWithLogo]}
        user={USER}
        collapsed={false}
      />,
    );
    await openMenu();

    const noveumOption = screen.getByTestId('workspace-option-noveum');
    const noveumImg = noveumOption.querySelector('img');
    expect(noveumImg).not.toBeNull();
    expect(noveumImg).toHaveAttribute('src', 'https://example.com/noveum.png');

    const cometOption = screen.getByTestId('workspace-option-comet');
    const cometImg = cometOption.querySelector('img');
    expect(cometImg).not.toBeNull();
    expect(cometImg).toHaveAttribute('src', 'https://example.com/comet.png');
  });
});
