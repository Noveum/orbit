import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CommandPalette } from '@/components/command-palette.tsx';
import { Sidebar } from '@/components/layout/sidebar.tsx';
import { ShortcutsOverlay } from '@/components/shortcuts-overlay.tsx';
import { Kbd, keyGlyph } from '@/components/ui/kbd.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { DocsWorkspace } from '@/features/docs/docs-workspace.tsx';
import { InboxView } from '@/features/inbox/inbox-view.tsx';
import { IssueProperties } from '@/features/issues/issue-properties.tsx';
import { IssueWorkspaceProvider } from '@/features/issues/workspace-provider.tsx';
import {
  formatBinding,
  type HotkeyEntry,
  HotkeyProvider,
  useHotkeyList,
} from '@/lib/keyboard/index.ts';
import { buildNavigation } from '@/lib/navigation.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import * as docsQuery from '@/lib/query/use-docs.ts';
import * as issuesQuery from '@/lib/query/use-issues.ts';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/inbox',
}));

mock.module('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: mock() }),
}));

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    organization: { setActive: mock() },
    signOut: mock(() => Promise.resolve()),
  },
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

mock.module('@/lib/query/use-issues.ts', () => ({
  ...issuesQuery,
  useBootstrap: () => ({ data: undefined }),
  useCreateIssue: () => ({ mutate: mock(), isPending: false }),
  useUpdateIssue: () => ({ mutate: mock(), isPending: false }),
}));

mock.module('@/lib/query/use-docs.ts', () => ({
  ...docsQuery,
  useDocs: () => ({ data: { docs: [], collections: [], projects: [] } }),
  useCreateCollection: () => ({ mutate: mock() }),
  useRenameCollection: () => ({ mutate: mock() }),
  useDeleteCollection: () => ({ mutate: mock() }),
}));

const issue: Issue = {
  id: 'issue_1',
  organizationId: 'org_1',
  teamId: 'team_1',
  number: 1,
  identifier: 'ENG-1',
  title: 'Domain auto join',
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

const sections = buildNavigation([{ id: 'team_1', key: 'ENG', name: 'Engineering' }], 3);

const noop = () => undefined;

let registered: readonly HotkeyEntry[] = [];

function HotkeyProbe() {
  registered = useHotkeyList();
  return null;
}

function Surfaces({ extra }: { readonly extra?: ReactNode }) {
  return (
    <TooltipProvider>
      <HotkeyProvider>
        <IssueWorkspaceProvider>
          <HotkeyProbe />
          <Sidebar
            workspace={{ id: 'org_1', name: 'Noveum', slug: 'noveum' }}
            workspaces={[]}
            user={{ name: 'Pulkit', email: 'pulkit@noveum.ai', image: null }}
            sections={sections}
            collapsed={false}
            onToggleCollapsed={noop}
            onOpenPalette={noop}
          />
          <CommandPalette
            open
            onOpenChange={noop}
            sections={sections}
            onToggleSidebar={noop}
            onShowShortcuts={noop}
          />
          <ShortcutsOverlay open onOpenChange={noop} />
          <IssueProperties issue={issue} />
          <InboxView items={[]} unreadCount={0} userId="user_1" />
          <DocsWorkspace docId={null} canWrite canPublish={false} />
          {extra}
        </IssueWorkspaceProvider>
      </HotkeyProvider>
    </TooltipProvider>
  );
}

function advertisedHints(): string[] {
  const byHost = new Map<Element, string[]>();
  for (const key of document.querySelectorAll('kbd')) {
    const host = key.parentElement;
    if (host === null) continue;
    byHost.set(host, [...(byHost.get(host) ?? []), key.textContent ?? '']);
  }
  return [...byHost.values()].map((keys) => keys.join(' '));
}

function boundHints(entries: readonly HotkeyEntry[]): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.enabled)
      .map((entry) => formatBinding(entry.binding).map(keyGlyph).join(' ')),
  );
}

function unbackedHints(): string[] {
  const bound = boundHints(registered);
  return advertisedHints().filter((hint) => !bound.has(hint));
}

describe('rendered keyboard hints', () => {
  it('never advertises a key the registry does not bind', () => {
    render(<Surfaces />);

    expect(advertisedHints().length).toBeGreaterThan(0);
    expect(unbackedHints()).toEqual([]);
  });

  it('catches a hint whose key nothing handles', () => {
    render(<Surfaces extra={<Kbd keys={['q']} />} />);

    expect(unbackedHints()).toEqual(['Q']);
  });
});
