import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Issue, IssueRelation } from '@/lib/query/schemas.ts';
import { render } from '@/test/render.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/issue/ENG-1',
  useParams: () => ({}),
}));

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

const { groupRelations, IssueRelations, RELATION_LABELS } = await import(
  '@/features/issues/issue-relations.tsx'
);

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
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
    ...overrides,
  };
}

function relation(overrides: Partial<IssueRelation> = {}): IssueRelation {
  return {
    id: 'relation_1',
    type: 'blocks',
    issue: issue({ id: 'issue_2', identifier: 'ENG-2', title: 'Downstream work' }),
    ...overrides,
  };
}

interface Call {
  readonly url: string;
  readonly method: string;
}

const originalFetch = globalThis.fetch;
const calls: Call[] = [];
const bodies: unknown[] = [];
let served: readonly IssueRelation[] = [];
let searchable: readonly Issue[] = [];

function stubFetch(): void {
  calls.length = 0;
  bodies.length = 0;
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
    if (method === 'DELETE') served = [];
    const payload = url.includes('/relations') ? { relations: served } : { issues: searchable };
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('groupRelations', () => {
  it('groups by type and drops empty groups', () => {
    const groups = groupRelations([
      relation(),
      relation({ id: 'relation_2', type: 'related' }),
      relation({ id: 'relation_3', type: 'blocks' }),
    ]);

    expect(groups.map((group) => group.type)).toEqual(['blocks', 'related']);
    expect(groups[0]?.entries).toHaveLength(2);
  });

  it('names every relation type the contract allows', () => {
    expect(RELATION_LABELS.blocked_by).toBe('Blocked by');
    expect(RELATION_LABELS.duplicate_of).toBe('Duplicate of');
  });
});

describe('IssueRelations', () => {
  it('reads the links from the server and shows them under their type', async () => {
    served = [relation()];
    stubFetch();

    render(<IssueRelations issue={issue()} />);

    expect(await screen.findByText('Downstream work')).toBeInTheDocument();
    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(calls[0]?.url).toContain('/api/issues/issue_1/relations');
    expect(calls[0]?.method).toBe('GET');
  });

  it('asks the server to unlink, naming the pair and the type', async () => {
    served = [relation()];
    stubFetch();

    render(<IssueRelations issue={issue()} />);
    fireEvent.click(await screen.findByTestId('unlink-ENG-2'));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    const removal = calls.find((call) => call.method === 'DELETE');
    expect(removal?.url).toContain('relatedIssueId=issue_2');
    expect(removal?.url).toContain('type=blocks');
  });

  it('holds the search open after a link type is chosen', async () => {
    served = [];
    stubFetch();
    const user = userEvent.setup();

    render(<IssueRelations issue={issue()} />);
    await user.click(await screen.findByTestId('add-relation'));
    await user.click(await screen.findByTestId('relation-type-blocked_by'));

    expect(await screen.findByTestId('relation-picker-search')).toBeInTheDocument();
  });

  it('links the picked issue under the chosen type', async () => {
    served = [];
    searchable = [issue({ id: 'issue_2', identifier: 'ENG-2', title: 'Downstream work' })];
    stubFetch();
    const user = userEvent.setup();

    render(<IssueRelations issue={issue()} />);
    await user.click(await screen.findByTestId('add-relation'));
    await user.click(await screen.findByTestId('relation-type-duplicate_of'));
    await user.type(await screen.findByTestId('relation-picker-search'), 'downstream');
    await user.click(await screen.findByTestId('relation-picker-option-ENG-2'));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(bodies.at(-1)).toEqual({ relatedIssueId: 'issue_2', type: 'duplicate_of' });
  });

  it('never renders a link the server did not send', async () => {
    served = [];
    stubFetch();

    render(<IssueRelations issue={issue()} />);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByText('Downstream work')).toBeNull();
    expect(screen.getByTestId('add-relation')).toBeInTheDocument();
  });
});
