import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HOTKEY_PRIORITY, HotkeyProvider, useHotkey } from './index.ts';

interface SurfaceProps {
  readonly onEnter: () => void;
  readonly onSpace: () => void;
  readonly onActivate: () => void;
}

function IssueSurface({ onEnter, onSpace, onActivate }: SurfaceProps) {
  useHotkey('enter', onEnter, { label: 'Open issue', section: 'Issues', scope: 'issues' });
  useHotkey('space', onSpace, { label: 'Peek issue', section: 'Issues', scope: 'issues' });

  return (
    <div>
      <button type="button" data-testid="new-issue" onClick={onActivate}>
        New issue
      </button>
      <a href="/team/eng/board" data-testid="view-board" onClick={onActivate}>
        Board
      </a>
      <div role="option" aria-selected="false" tabIndex={0} data-testid="filter-chip">
        Assignee is Aditi
      </div>
      <div data-testid="rows" tabIndex={-1}>
        ENG-1
      </div>
    </div>
  );
}

function renderSurface() {
  const handlers = { onEnter: mock(), onSpace: mock(), onActivate: mock() };
  render(
    <HotkeyProvider>
      <IssueSurface {...handlers} />
    </HotkeyProvider>,
  );
  return handlers;
}

describe('activation keys', () => {
  it('activates a focused button instead of running the enter binding', async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    await user.tab();
    expect(screen.getByTestId('new-issue')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onEnter).not.toHaveBeenCalled();
  });

  it('leaves enter and space to a focused link and to a role=option row', async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    screen.getByTestId('view-board').focus();
    await user.keyboard('{Enter}');
    expect(handlers.onEnter).not.toHaveBeenCalled();

    screen.getByTestId('filter-chip').focus();
    await user.keyboard('{Enter}[Space]');
    expect(handlers.onEnter).not.toHaveBeenCalled();
    expect(handlers.onSpace).not.toHaveBeenCalled();
  });

  it('still runs the bindings when no control holds focus', async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    screen.getByTestId('rows').focus();
    await user.keyboard('{Enter}[Space]');
    expect(handlers.onEnter).toHaveBeenCalledTimes(1);
    expect(handlers.onSpace).toHaveBeenCalledTimes(1);
  });
});

function LayerSurface({ onEscape }: { readonly onEscape: () => void }) {
  useHotkey('escape', onEscape, {
    label: 'Clear the selection',
    section: 'Issues',
    scope: 'issues',
    preventDefault: false,
  });

  return (
    <div
      data-testid="layer"
      role="menu"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.preventDefault();
      }}
    >
      menu
    </div>
  );
}

describe('an open layer that handles the key itself', () => {
  it('keeps the global binding out of an escape the layer already handled', async () => {
    const user = userEvent.setup();
    const onEscape = mock();
    render(
      <HotkeyProvider>
        <LayerSurface onEscape={onEscape} />
      </HotkeyProvider>,
    );

    screen.getByTestId('layer').focus();
    await user.keyboard('{Escape}');
    expect(onEscape).not.toHaveBeenCalled();

    document.body.focus();
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

function GlobalCreate({ onRun }: { readonly onRun: () => void }) {
  useHotkey('c', onRun, { label: 'Create issue', section: 'Issues' });
  return null;
}

function DocsCreate({ onRun }: { readonly onRun: () => void }) {
  useHotkey('c', onRun, {
    label: 'New doc',
    section: 'Navigation',
    scope: 'docs',
    priority: HOTKEY_PRIORITY.surface,
  });
  return null;
}

describe('scoped bindings', () => {
  async function pressC(globalFirst: boolean) {
    const user = userEvent.setup();
    const onGlobal = mock();
    const onDocs = mock();
    render(
      <HotkeyProvider>
        {globalFirst ? <GlobalCreate onRun={onGlobal} /> : <DocsCreate onRun={onDocs} />}
        {globalFirst ? <DocsCreate onRun={onDocs} /> : <GlobalCreate onRun={onGlobal} />}
      </HotkeyProvider>,
    );
    await user.keyboard('c');
    return { onGlobal, onDocs };
  }

  it('runs the surface binding when the global one registered first', async () => {
    const { onGlobal, onDocs } = await pressC(true);
    expect(onDocs).toHaveBeenCalledTimes(1);
    expect(onGlobal).not.toHaveBeenCalled();
  });

  it('runs the surface binding when it registered first', async () => {
    const { onGlobal, onDocs } = await pressC(false);
    expect(onDocs).toHaveBeenCalledTimes(1);
    expect(onGlobal).not.toHaveBeenCalled();
  });
});
