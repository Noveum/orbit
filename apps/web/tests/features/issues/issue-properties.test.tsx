import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { DEFAULT_ESTIMATE_SCALE, ISSUE_REVIEWER_MAX_COUNT } from '@orbit/shared/constants';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { resolvedHotkeys } from '@/components/shortcuts-overlay.tsx';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { estimateLabel } from '@/features/issues/estimate-glyph.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider, useHotkeyList } from '@/lib/keyboard/index.ts';
import { createQueryClient } from '@/lib/query/provider.tsx';
import type { Issue, Member, Milestone } from '@/lib/query/schemas.ts';

const patches: Record<string, unknown>[] = [];

mock.module('@/lib/query/use-issues.ts', () => ({
  useUpdateIssue: () => ({
    mutate: (input: { issue: Issue; patch: Record<string, unknown> }) => {
      patches.push(input.patch);
    },
  }),
}));

const firstReviewer: Member = {
  id: 'reviewer_1',
  name: 'Ada Reviewer',
  email: 'ada@orbit.test',
  image: '/ada.png',
  handle: 'ada',
  role: 'member',
};

const secondReviewer: Member = {
  id: 'reviewer_2',
  name: 'Bo Reviewer',
  email: 'bo@orbit.test',
  image: '/bo.png',
  handle: 'bo',
  role: 'member',
};

const workspaceMembers = [firstReviewer, secondReviewer] as const;

const workspace: WorkspaceData = {
  ...({} as WorkspaceData),
  ready: true,
  userId: 'user_1',
  role: 'admin',
  teams: [{ id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#5a63c8' }],
  states: [
    {
      id: 'state_todo',
      teamId: 'team_eng',
      name: 'Todo',
      category: 'unstarted',
      color: '#5a63c8',
      position: 1,
    },
  ],
  labels: [],
  members: workspaceMembers,
  projects: [
    {
      id: 'project_launch',
      slug: 'launch',
      name: 'Launch',
      status: 'started',
      color: '#5a63c8',
      icon: 'box',
      teamIds: ['team_eng'],
    },
    {
      id: 'project_growth',
      slug: 'growth',
      name: 'Growth',
      status: 'started',
      color: '#5a63c8',
      icon: 'box',
      teamIds: ['team_growth'],
    },
    {
      id: 'project_company',
      slug: 'company',
      name: 'Company wide',
      status: 'started',
      color: '#5a63c8',
      icon: 'box',
      teamIds: [],
    },
  ],
  cycles: [
    {
      id: 'cycle_7',
      teamId: 'team_eng',
      number: 7,
      name: 'Sprint 7',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-01-14T00:00:00.000Z',
      completedAt: null,
    },
  ],
  seedIssues: [],
  stateById: new Map(),
  labelById: new Map(),
  memberById: new Map(workspaceMembers.map((member) => [member.id, member])),
  openQuickCreate: () => undefined,
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { IssueProperties } = await import('@/features/issues/issue-properties.tsx');
const { IssueDeletionProvider } = await import('@/features/issues/issue-deletion.tsx');

const milestones: readonly Milestone[] = [
  {
    id: 'milestone_alpha',
    projectId: 'project_launch',
    name: 'Alpha',
    description: '',
    targetDate: null,
    sortOrder: 1,
    scope: 0,
    completed: 0,
  },
  {
    id: 'milestone_beta',
    projectId: 'project_launch',
    name: 'Beta',
    description: '',
    targetDate: null,
    sortOrder: 2,
    scope: 0,
    completed: 0,
  },
];

const requested: string[] = [];
const originalFetch = globalThis.fetch;

function stubFetch(): void {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    requested.push(String(input));
    if ((init?.method ?? 'GET') === 'DELETE') {
      return Promise.resolve(Response.json({ deleted: { id: 'issue_1', identifier: 'ENG-1' } }));
    }
    return Promise.resolve(Response.json({ milestones }));
  }) as unknown as typeof fetch;
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the importer',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_1',
    assigneeId: null,
    projectId: 'project_launch',
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1024,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    stateEnteredAt: '2026-06-08T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <HotkeyProvider>{children}</HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function HotkeyNames() {
  const live = resolvedHotkeys(useHotkeyList());
  return (
    <ul data-testid="hotkey-names">
      {live.map((entry) => (
        <li key={entry.id}>{entry.label}</li>
      ))}
    </ul>
  );
}

function mountProperties(row: Issue) {
  render(
    <Providers>
      <IssueProperties issue={row} />
    </Providers>,
  );
}

beforeEach(() => {
  patches.length = 0;
  requested.length = 0;
  Object.assign(workspace, {
    role: 'admin',
    members: workspaceMembers,
    memberById: new Map(workspaceMembers.map((member) => [member.id, member])),
  });
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the milestone row on the issue properties panel', () => {
  it('reads the milestones of the project the issue is on', async () => {
    mountProperties(issue());

    await waitFor(() => expect(requested).toContain('/api/projects/project_launch/milestones'));
  });

  it('sets a milestone the user picks', async () => {
    const user = userEvent.setup();
    mountProperties(issue());
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));

    await user.click(screen.getByTestId('property-milestone'));
    const menu = await screen.findByTestId('menu-milestone');
    await user.click(await within(menu).findByText('Beta'));

    await waitFor(() => expect(patches).toEqual([{ milestoneId: 'milestone_beta' }]));
  });

  it('clears the milestone when the user picks none', async () => {
    const user = userEvent.setup();
    mountProperties(issue({ milestoneId: 'milestone_alpha' }));
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(screen.getByTestId('property-milestone')).toHaveTextContent('Alpha');

    await user.click(screen.getByTestId('property-milestone'));
    const menu = await screen.findByTestId('menu-milestone');
    await user.click(await within(menu).findByText('No milestone'));

    await waitFor(() => expect(patches).toEqual([{ milestoneId: null }]));
  });

  it('asks for nothing and offers nothing when the issue is on no project', async () => {
    mountProperties(issue({ projectId: null }));

    expect(await screen.findByTestId('property-milestone-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('property-milestone')).toBeNull();
    expect(requested).toEqual([]);
  });

  it('stops advertising the m shortcut when there is no milestone menu to open', async () => {
    render(
      <Providers>
        <IssueProperties issue={issue({ projectId: null })} />
        <HotkeyNames />
      </Providers>,
    );

    const names = await screen.findByTestId('hotkey-names');
    expect(names).not.toHaveTextContent('Change milestone');
    expect(names).toHaveTextContent('Change project');

    const row = screen.getByTestId('property-milestone-empty').parentElement;
    expect(row?.textContent).toContain('Milestone');
    expect(row?.querySelector('kbd')).toBeNull();
  });

  it('advertises the m shortcut once the issue is on a project', async () => {
    render(
      <Providers>
        <IssueProperties issue={issue()} />
        <HotkeyNames />
      </Providers>,
    );

    expect(await screen.findByTestId('hotkey-names')).toHaveTextContent('Change milestone');
  });
});

describe('the project row on the issue properties panel', () => {
  it('offers only the projects the issue team can be put on', async () => {
    const user = userEvent.setup();
    mountProperties(issue({ projectId: null }));

    await user.click(screen.getByTestId('property-project'));
    const menu = await screen.findByTestId('menu-project');

    expect(within(menu).getByText('Launch')).toBeInTheDocument();
    expect(within(menu).getByText('Company wide')).toBeInTheDocument();
    expect(within(menu).queryByText('Growth')).toBeNull();
  });

  it('sets the project the user picks', async () => {
    const user = userEvent.setup();
    mountProperties(issue({ projectId: null }));

    await user.click(screen.getByTestId('property-project'));
    const menu = await screen.findByTestId('menu-project');
    await user.click(within(menu).getByText('Company wide'));

    await waitFor(() => expect(patches).toEqual([{ projectId: 'project_company' }]));
  });

  it('keeps showing a project the issue already sits on even when the team moved away', async () => {
    const user = userEvent.setup();
    mountProperties(issue({ projectId: 'project_growth' }));

    expect(screen.getByTestId('property-project')).toHaveTextContent('Growth');
    await user.click(screen.getByTestId('property-project'));
    const menu = await screen.findByTestId('menu-project');

    expect(within(menu).getByText('Growth')).toBeInTheDocument();
  });
});

describe('the reviewer row on the issue properties panel', () => {
  it('shows every current reviewer and adds another selected person', async () => {
    const user = userEvent.setup();
    mountProperties(issue({ reviewerIds: [firstReviewer.id] }));

    expect(screen.getByTestId('property-reviewers')).toHaveTextContent(firstReviewer.name);
    await user.click(screen.getByTestId('property-reviewers'));
    const menu = await screen.findByTestId('menu-reviewers');
    expect(
      within(menu).getByText(firstReviewer.name).parentElement?.querySelector('[role="img"]'),
    ).not.toBeNull();
    expect(
      within(menu).getByText(secondReviewer.name).parentElement?.querySelector('[role="img"]'),
    ).not.toBeNull();
    await user.click(within(menu).getByText(secondReviewer.name));

    await waitFor(() =>
      expect(patches).toEqual([{ reviewerIds: [firstReviewer.id, secondReviewer.id] }]),
    );
  });

  it('disables a fifty-first reviewer while keeping removal available', async () => {
    const user = userEvent.setup();
    const members = Array.from({ length: ISSUE_REVIEWER_MAX_COUNT + 1 }, (_value, index) => ({
      id: `reviewer_${index + 1}`,
      name: `Reviewer ${index + 1}`,
      email: `reviewer-${index + 1}@orbit.test`,
      image: null,
      handle: `reviewer-${index + 1}`,
      role: 'member',
    }));
    const selected = members.slice(0, ISSUE_REVIEWER_MAX_COUNT).map((member) => member.id);
    Object.assign(workspace, {
      members,
      memberById: new Map(members.map((member) => [member.id, member])),
    });
    mountProperties(issue({ reviewerIds: selected }));

    await user.click(screen.getByTestId('property-reviewers'));
    const menu = await screen.findByTestId('menu-reviewers');
    const blocked = within(menu)
      .getByText(`Reviewer ${ISSUE_REVIEWER_MAX_COUNT + 1}`)
      .closest('[role="menuitemcheckbox"]');
    const removable = within(menu).getByText('Reviewer 1').closest('[role="menuitemcheckbox"]');
    if (blocked === null || removable === null) throw new Error('missing reviewer option');

    expect(blocked).toHaveAttribute('data-disabled');
    await user.click(blocked);
    expect(patches).toEqual([]);

    await user.click(removable);
    await waitFor(() => expect(patches).toEqual([{ reviewerIds: selected.slice(1) }]));
  });

  it('removes a selected reviewer without changing the assignee', async () => {
    const user = userEvent.setup();
    mountProperties(issue({ assigneeId: firstReviewer.id, reviewerIds: [firstReviewer.id] }));

    await user.click(screen.getByTestId('property-reviewers'));
    await user.click(
      within(await screen.findByTestId('menu-reviewers')).getByText(firstReviewer.name),
    );

    await waitFor(() => expect(patches).toEqual([{ reviewerIds: [] }]));
  });
});

describe('the delete affordance on the properties panel', () => {
  it('sits in the panel rather than only behind the header menu', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <Providers>
        <IssueDeletionProvider>
          <IssueProperties issue={issue()} />
        </IssueDeletionProvider>
      </Providers>,
    );

    await user.click(screen.getByTestId('property-delete-issue'));

    expect(await screen.findByTestId('delete-issue-dialog')).toBeInTheDocument();
  });

  it('closes the surface the issue was open on once the delete goes through', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const left = mock();
    render(
      <Providers>
        <IssueDeletionProvider>
          <IssueProperties issue={issue()} onDeleted={left} />
        </IssueDeletionProvider>
      </Providers>,
    );

    await user.click(screen.getByTestId('property-delete-issue'));
    await user.click(await screen.findByTestId('confirm-delete-issue'));

    await waitFor(() => expect(left).toHaveBeenCalled());
  });

  it('stays hidden from a role that cannot delete', () => {
    const previous = workspace.role;
    Object.assign(workspace, { role: 'guest' });
    render(
      <Providers>
        <IssueDeletionProvider>
          <IssueProperties issue={issue()} />
        </IssueDeletionProvider>
      </Providers>,
    );

    expect(screen.queryByTestId('property-delete-issue')).not.toBeInTheDocument();
    Object.assign(workspace, { role: previous });
  });
});

describe('reaching what the properties panel names', () => {
  it('offers a way into the project rather than only a picker', () => {
    render(
      <Providers>
        <IssueProperties issue={issue()} />
      </Providers>,
    );

    expect(screen.getByTestId('open-project')).toHaveAttribute('href', '/projects/launch');
  });

  it('offers a way into the sprint the issue sits in', () => {
    render(
      <Providers>
        <IssueProperties issue={issue({ cycleId: 'cycle_7' })} />
      </Providers>,
    );

    expect(screen.getByTestId('open-sprint')).toHaveAttribute('href', '/team/eng/sprint/7');
  });

  it('hides the project link when the payload carried no slug, rather than linking nowhere', () => {
    const projects = workspace.projects;
    Object.assign(workspace, {
      projects: projects.map((entry) => ({ ...entry, slug: '' })),
    });

    render(
      <Providers>
        <IssueProperties issue={issue()} />
      </Providers>,
    );

    expect(screen.getByTestId('property-project')).toHaveTextContent('Launch');
    expect(screen.queryByTestId('open-project')).not.toBeInTheDocument();
    Object.assign(workspace, { projects });
  });

  it('offers no link when the issue is on no project and no sprint', () => {
    render(
      <Providers>
        <IssueProperties issue={issue({ projectId: null, cycleId: null })} />
      </Providers>,
    );

    expect(screen.queryByTestId('open-project')).not.toBeInTheDocument();
    expect(screen.queryByTestId('open-sprint')).not.toBeInTheDocument();
  });
});

describe('the estimate row on the issue properties panel', () => {
  it('carries a glyph beside the reading, so estimate matches every other property', () => {
    mountProperties(issue({ estimate: 3 }));

    const row = screen.getByTestId('property-estimate');
    expect(row).toHaveTextContent('3 points');
    expect(within(row).getByLabelText('3 points').tagName.toLowerCase()).toBe('svg');
  });

  it('shows an empty glyph and no reading when the issue has no estimate', () => {
    mountProperties(issue());

    const row = screen.getByTestId('property-estimate');
    expect(row).toHaveTextContent('No estimate');
    expect(within(row).getByLabelText('No estimate')).toBeInTheDocument();
  });

  it('says one point rather than 1 points', () => {
    mountProperties(issue({ estimate: 1 }));

    expect(screen.getByTestId('property-estimate')).toHaveTextContent(/^1 point$/);
  });

  it('announces the row once, not twice, because the glyph repeats the reading', () => {
    mountProperties(issue({ estimate: 3 }));

    expect(screen.getByRole('button', { name: '3 points' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3 points 3 points' })).toBeNull();
  });

  it('names every glyph bearing row in the panel after its visible text alone', () => {
    mountProperties(issue({ estimate: 3, priority: 1 }));

    for (const row of ['property-status', 'property-priority', 'property-estimate']) {
      const button = screen.getByTestId(row);
      expect(button).toHaveAccessibleName((button.textContent ?? '').trim());
    }
  });

  it('offers every step of the scale with its own glyph', async () => {
    const user = userEvent.setup();
    mountProperties(issue());

    await user.click(screen.getByTestId('property-estimate'));
    const menu = await screen.findByTestId('menu-estimate');

    for (const points of DEFAULT_ESTIMATE_SCALE) {
      const option = within(menu).getByText(estimateLabel(points)).parentElement;
      expect(option?.querySelector('svg')).not.toBeNull();
    }
  });

  it('leaves a menu option named once, with the glyph hidden behind the label', async () => {
    const user = userEvent.setup();
    mountProperties(issue());

    await user.click(screen.getByTestId('property-estimate'));
    const menu = await screen.findByTestId('menu-estimate');

    const option = within(menu).getByText('5 points').parentElement;
    expect(option?.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(within(menu).getByRole('menuitemradio', { name: '5 points' })).toBeInTheDocument();
  });

  it('sets the estimate the user picks', async () => {
    const user = userEvent.setup();
    mountProperties(issue());

    await user.click(screen.getByTestId('property-estimate'));
    const menu = await screen.findByTestId('menu-estimate');
    await user.click(within(menu).getByText('8 points'));

    await waitFor(() => expect(patches).toEqual([{ estimate: 8 }]));
  });

  it('clears the estimate when the user picks none', async () => {
    const user = userEvent.setup();
    mountProperties(issue({ estimate: 5 }));

    await user.click(screen.getByTestId('property-estimate'));
    const menu = await screen.findByTestId('menu-estimate');
    await user.click(within(menu).getByText('No estimate'));

    await waitFor(() => expect(patches).toEqual([{ estimate: null }]));
  });
});
