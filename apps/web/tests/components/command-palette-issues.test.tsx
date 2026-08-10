import { beforeEach, describe, expect, it, mock } from 'bun:test';
import userEvent from '@testing-library/user-event';
import * as nextThemes from 'next-themes';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { buildNavigation } from '@/lib/navigation.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { fireEvent, render, screen } from '@/test/render.tsx';
import { restoreModulesAfterThisFile } from '../../tests-support.ts';

await restoreModulesAfterThisFile(['@/lib/query/use-issue-search.ts']);

const push = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/inbox',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

mock.module('next-themes', () => ({
  ...nextThemes,
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: mock() }),
}));

function issue(number: number, title: string): Issue {
  return {
    id: `issue_${number}`,
    organizationId: 'org_1',
    teamId: 'team_1',
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_1',
    assigneeId: null,
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1024,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    stateEnteredAt: '2026-01-01T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
  };
}

const results: readonly Issue[] = [
  issue(12, 'Presence expires too early'),
  issue(31, 'Board drag'),
];

mock.module('@/lib/query/use-issue-search.ts', () => ({
  useIssueSearch: (term: string) => ({
    issues: term.trim().length === 0 ? [] : results,
    searching: false,
  }),
}));

const { CommandPalette } = await import('@/components/command-palette.tsx');

const sections = buildNavigation([{ id: 'team_1', key: 'ENG', name: 'Engineering' }]);

function renderPalette() {
  render(
    <HotkeyProvider>
      <CommandPalette
        open
        onOpenChange={mock()}
        sections={sections}
        onToggleSidebar={() => undefined}
        onShowShortcuts={() => undefined}
      />
    </HotkeyProvider>,
  );
}

async function search(term: string) {
  await userEvent.setup().type(await screen.findByPlaceholderText(/Search issues/), term);
}

beforeEach(() => {
  push.mockClear();
});

describe('command palette issue results', () => {
  it('renders every hit as a real link to its issue page', async () => {
    renderPalette();
    await search('pres');

    const first = await screen.findByTestId('palette-issue-ENG-12');
    const link = first.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/issue/ENG-12');

    const second = screen.getByTestId('palette-issue-ENG-31');
    expect(second.querySelector('a')?.getAttribute('href')).toBe('/issue/ENG-31');
  });

  it('keeps a hit out of the tab order inside the dialog', async () => {
    const user = userEvent.setup();
    renderPalette();
    await search('pres');

    const link = (await screen.findByTestId('palette-issue-ENG-12')).querySelector('a');
    expect(link).not.toBeNull();
    if (link === null) return;

    const input = await screen.findByPlaceholderText(/Search issues/);
    input.focus();
    await user.tab();

    expect(document.activeElement).not.toBe(link);
    expect(link.closest('[role="option"]')).not.toBeNull();
  });

  it('lets a modified click open the issue in a new tab without routing this one', async () => {
    renderPalette();
    await search('pres');

    const link = (await screen.findByTestId('palette-issue-ENG-12')).querySelector('a');
    expect(link).not.toBeNull();
    if (link === null) return;

    fireEvent.click(link, { metaKey: true });
    expect(push).not.toHaveBeenCalled();
  });
});
