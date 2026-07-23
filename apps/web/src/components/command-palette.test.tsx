import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { CommandPalette } from '@/components/command-palette.tsx';
import { ShortcutsOverlay } from '@/components/shortcuts-overlay.tsx';
import { HOTKEY_PRIORITY, HotkeyProvider, useHotkey } from '@/lib/keyboard/index.ts';
import { buildNavigation } from '@/lib/navigation.ts';

const push = mock();
const setTheme = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock() }),
  usePathname: () => '/inbox',
}));

mock.module('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme }),
}));

const sections = buildNavigation([{ id: 'team_1', key: 'ENG', name: 'Engineering' }]);

const noop = () => undefined;

function Palette({
  startOpen = false,
  onToggleSidebar = noop,
  onShowShortcuts = noop,
  children,
}: {
  readonly startOpen?: boolean;
  readonly onToggleSidebar?: () => void;
  readonly onShowShortcuts?: () => void;
  readonly children?: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <HotkeyProvider>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        sections={sections}
        onToggleSidebar={onToggleSidebar}
        onShowShortcuts={onShowShortcuts}
      />
      {children}
    </HotkeyProvider>
  );
}

function CreateIssue({ run }: { readonly run: () => void }) {
  useHotkey('c', run, { label: 'Create issue', section: 'Issues' });
  return null;
}

function NewDoc({ run }: { readonly run: () => void }) {
  useHotkey('c', run, {
    label: 'New doc',
    section: 'Navigation',
    scope: 'docs',
    priority: HOTKEY_PRIORITY.surface,
  });
  return null;
}

function ArchiveIssue({ enabled }: { readonly enabled: boolean }) {
  useHotkey('shift+a', noop, { label: 'Archive issue', section: 'Issues', enabled });
  return null;
}

async function select(name: RegExp) {
  await userEvent.setup().click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  push.mockClear();
  setTheme.mockClear();
});

describe('command palette', () => {
  it('opens on its own binding and lists every navigable surface', async () => {
    const user = userEvent.setup();
    render(<Palette />);

    await user.keyboard('{Meta>}k{/Meta}');

    for (const label of [
      /Go to Inbox/,
      /Go to My issues/,
      /Go to Projects/,
      /Go to Cycles/,
      /Go to Views/,
      /Go to Docs/,
      /Go to Engineering issues/,
      /Go to Engineering board/,
      /Go to Engineering active cycle/,
      /Go to Settings/,
    ]) {
      expect(await screen.findByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('routes the same way whether the command is run or the binding is pressed', async () => {
    const user = userEvent.setup();
    render(<Palette startOpen />);

    await select(/Go to Inbox/);
    expect(push).toHaveBeenCalledWith('/inbox');

    push.mockClear();
    await user.keyboard('gi');
    expect(push).toHaveBeenCalledWith('/inbox');
  });

  it('runs the toggles it advertises', async () => {
    const toggleSidebar = mock();
    const showShortcuts = mock();
    render(<Palette startOpen onToggleSidebar={toggleSidebar} onShowShortcuts={showShortcuts} />);

    await select(/Switch to light theme/);
    expect(setTheme).toHaveBeenCalledWith('light');

    await userEvent.setup().keyboard('[[');
    expect(toggleSidebar).toHaveBeenCalled();

    await userEvent.setup().keyboard('?');
    expect(showShortcuts).toHaveBeenCalled();
  });

  it('leaves the binding to a focused editor', async () => {
    const user = userEvent.setup();
    render(
      <Palette>
        <textarea aria-label="Description" />
      </Palette>,
    );

    await user.click(screen.getByLabelText('Description'));
    await user.keyboard('{Meta>}k{/Meta}');

    expect(screen.queryByPlaceholderText('Type a command or search')).not.toBeInTheDocument();
  });

  it('runs a context command through the handler that owns its binding', async () => {
    const create = mock();
    render(
      <Palette startOpen>
        <CreateIssue run={create} />
      </Palette>,
    );

    await select(/Create issue/);
    expect(create).toHaveBeenCalled();
  });

  it('drops the key from a command whose binding another surface has taken', async () => {
    render(
      <Palette startOpen>
        <CreateIssue run={noop} />
        <NewDoc run={noop} />
      </Palette>,
    );

    expect(await screen.findByRole('option', { name: /New doc C/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Create issue' })).toBeInTheDocument();
  });
});

describe('shortcuts overlay', () => {
  it('lists the live winner of a shared binding and hides disabled ones', async () => {
    render(
      <HotkeyProvider>
        <ShortcutsOverlay open onOpenChange={noop} />
        <CreateIssue run={noop} />
        <NewDoc run={noop} />
        <ArchiveIssue enabled={false} />
      </HotkeyProvider>,
    );

    const list = await screen.findByTestId('shortcuts-sections');
    expect(list.textContent).toContain('New doc');
    expect(list.textContent).not.toContain('Create issue');
    expect(list.textContent).not.toContain('Archive issue');
  });

  it('groups what it lists by section', async () => {
    render(
      <HotkeyProvider>
        <ShortcutsOverlay open onOpenChange={noop} />
        <CreateIssue run={noop} />
        <ArchiveIssue enabled />
      </HotkeyProvider>,
    );

    const list = await screen.findByTestId('shortcuts-sections');
    const headings = [...list.querySelectorAll('h3')].map((node) => node.textContent);
    expect(headings).toEqual(['Issues']);
  });
});
