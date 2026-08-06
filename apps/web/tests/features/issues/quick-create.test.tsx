import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';

const created = mock((_input: Record<string, unknown>) => undefined);
const patched = mock((_input: Record<string, unknown>) => undefined);

const newIssue = { id: 'iss_1', identifier: 'ENG-1', title: 'Ship the thing' };

const inFlight: { defer: boolean; resume: (() => void) | null; pending: boolean } = {
  defer: false,
  resume: null,
  pending: false,
};

mock.module('@/lib/query/use-issues.ts', () => ({
  useCreateIssue: () => ({
    mutate: (
      input: Record<string, unknown>,
      options?: { onSuccess?: (issue: typeof newIssue) => void },
    ) => {
      created(input);
      if (!inFlight.defer) {
        options?.onSuccess?.(newIssue);
        return;
      }
      inFlight.pending = true;
      inFlight.resume = () => {
        inFlight.pending = false;
        options?.onSuccess?.(newIssue);
      };
    },
    get isPending() {
      return inFlight.pending;
    },
  }),
  useUpdateIssue: () => ({
    mutateAsync: async (input: Record<string, unknown>) => {
      patched(input);
      return await Promise.resolve(newIssue);
    },
  }),
}));

let workspace: WorkspaceData;
mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { QuickCreateDialog } = await import('@/features/issues/quick-create.tsx');

function buildWorkspace(): WorkspaceData {
  return {
    ...({} as WorkspaceData),
    ready: true,
    teams: [{ id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#fff' }],
    states: [
      {
        id: 'state_todo',
        teamId: 'team_eng',
        name: 'Todo',
        category: 'unstarted',
        color: '#888',
        position: 1,
      },
    ],
    members: [
      { id: 'me', name: 'Shashank', email: 's@x.co', image: null, handle: 's', role: 'admin' },
    ],
    labels: [{ id: 'label_bug', teamId: 'team_eng', name: 'Bug', color: '#f00' }],
    projects: [
      {
        id: 'proj_1',
        name: 'API market',
        status: 'started',
        color: '#00f',
        icon: 'box',
        teamIds: ['team_eng'],
      },
      {
        id: 'proj_2',
        name: 'Brand refresh',
        status: 'started',
        color: '#0f0',
        icon: 'box',
        teamIds: ['team_des'],
      },
    ],
    cycles: [
      {
        id: 'cycle_1',
        teamId: 'team_eng',
        number: 3,
        name: '',
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-08-14T00:00:00.000Z',
        completedAt: null,
      },
    ],
  };
}

const realFetch = globalThis.fetch;
const realXhr = globalThis.XMLHttpRequest;

afterEach(() => {
  cleanup();
  created.mockClear();
  patched.mockClear();
  globalThis.fetch = realFetch;
  globalThis.XMLHttpRequest = realXhr;
});

function open() {
  render(
    <ToastProvider>
      <QuickCreateDialog open onOpenChange={() => undefined} defaultTeamId="team_eng" />
    </ToastProvider>,
  );
}

const STORAGE_KEY = 'org_1/2026/08/notes-1.txt';

interface PresignBody {
  readonly parentType?: unknown;
  readonly parentId?: unknown;
  readonly fileName?: unknown;
}

function stubAttachmentApi(): PresignBody[] {
  const presigns: PresignBody[] = [];
  const attachment = {
    id: 'att_1',
    parentType: 'issue',
    parentId: newIssue.id,
    fileName: 'notes [1].txt',
    contentType: 'text/plain',
    size: 4,
    storageKey: STORAGE_KEY,
    status: 'pending',
  };
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url === '/api/attachments/presign') {
      presigns.push(JSON.parse(String(init?.body ?? '{}')) as PresignBody);
      return Promise.resolve(
        json({
          attachment,
          upload: {
            key: STORAGE_KEY,
            url: 'https://s3.example.com/signed',
            method: 'PUT',
            headers: { 'content-type': 'text/plain' },
          },
        }),
      );
    }
    return Promise.resolve(json({ attachment: { ...attachment, status: 'ready' } }));
  }) as unknown as typeof fetch;
  return presigns;
}

function stubPut(status = 200): string[] {
  const sent: string[] = [];
  class FakeXhr {
    status = 0;
    private readonly listeners = new Map<string, () => void>();
    readonly upload = { addEventListener: () => undefined };
    private target = '';
    open(_method: string, url: string): void {
      this.target = url;
    }
    setRequestHeader(): void {
      this.status = 0;
    }
    addEventListener(name: string, run: () => void): void {
      this.listeners.set(name, run);
    }
    send(): void {
      sent.push(this.target);
      this.status = status;
      this.listeners.get('loadend')?.();
    }
  }
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  return sent;
}

async function holdOneFile(): Promise<void> {
  const user = userEvent.setup({ pointerEventsCheck: 0, applyAccept: false });
  await user.type(screen.getByTestId('quick-create-title'), 'Ship the thing');
  await user.upload(
    screen.getByTestId('quick-create-description-file'),
    new File(['body'], 'notes [1].txt', { type: 'text/plain' }),
  );
  await screen.findByTestId('quick-create-pending');
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('attaching a file from the create dialog', () => {
  it('offers the file picker even though the issue does not exist yet', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.getByTestId('quick-create-description-file')).toBeTruthy();
  });

  it('holds the file, says so, and creates the issue with a placeholder in the body', async () => {
    workspace = buildWorkspace();
    open();
    stubAttachmentApi();
    stubPut();

    await holdOneFile();
    expect(screen.getByTestId('quick-create-pending')).toHaveTextContent(
      '1 file will be attached once the issue is created.',
    );

    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(screen.getByTestId('quick-create-submit'));

    const body = created.mock.calls[0]?.[0]?.['description'];
    expect(typeof body).toBe('string');
    expect(String(body)).toContain('notes \\[1\\].txt');
    expect(String(body)).toContain('blob:');
    await waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
  });

  it('uploads against the new issue and rewrites the placeholder into a real link', async () => {
    workspace = buildWorkspace();
    open();
    const presigns = stubAttachmentApi();
    stubPut();

    await holdOneFile();
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(screen.getByTestId('quick-create-submit'));

    await waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
    expect(presigns).toHaveLength(1);
    expect(presigns[0]?.parentType).toBe('issue');
    expect(presigns[0]?.parentId).toBe(newIssue.id);
    expect(presigns[0]?.fileName).toBe('notes [1].txt');

    const patch = patched.mock.calls[0]?.[0]?.['patch'] as { description?: string } | undefined;
    expect(patch?.description).toContain(`[notes \\[1\\].txt](/api/files/${STORAGE_KEY})`);
    expect(patch?.description).not.toContain('blob:');
  });

  it('saves the issue without a dead placeholder when the upload fails', async () => {
    workspace = buildWorkspace();
    open();
    const presigns = stubAttachmentApi();
    const puts = stubPut(403);

    await holdOneFile();
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(screen.getByTestId('quick-create-submit'));

    await waitFor(() => expect(presigns).toHaveLength(1));
    await waitFor(() => expect(puts).toEqual(['https://s3.example.com/signed']));
    await settle();

    await waitFor(() => expect(patched).toHaveBeenCalled());
    const call = patched.mock.calls[0]?.[0];
    const patch = (call?.['patch'] ?? {}) as { description?: string };
    const saved = patch.description ?? '';
    expect(saved).not.toContain('blob:');
  });

  it('does not start a second create while the first is still in flight', async () => {
    workspace = buildWorkspace();
    open();
    inFlight.defer = true;
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.type(screen.getByTestId('quick-create-title'), 'Twice');
    const form = screen.getByTestId('quick-create-title').closest('form');
    if (form === null) throw new Error('no form');

    fireEvent.keyDown(form, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(form, { key: 'Enter', metaKey: true });
    await settle();

    expect(created.mock.calls).toHaveLength(1);

    inFlight.resume?.();
    inFlight.defer = false;
    await settle();
  });

  it('clears the editor for the next issue when create more is on', async () => {
    workspace = buildWorkspace();
    open();
    stubAttachmentApi();
    stubPut();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByTestId('quick-create-more'));
    await holdOneFile();
    await user.click(screen.getByTestId('quick-create-submit'));
    await settle();

    await user.type(screen.getByTestId('quick-create-title'), 'Second');
    await user.click(screen.getByTestId('quick-create-submit'));
    await settle();

    const second = created.mock.calls[1]?.[0];
    expect(second).toBeDefined();
    expect(String(second?.['description'] ?? '')).not.toContain('blob:');
  });

  it('forgets held files once the issue is created', async () => {
    workspace = buildWorkspace();
    open();
    stubAttachmentApi();
    stubPut();

    await holdOneFile();
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(screen.getByTestId('quick-create-submit'));

    await waitFor(() => expect(screen.queryByTestId('quick-create-pending')).toBeNull());
    await waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
  });
});

describe('the new issue dialog', () => {
  it('offers only the projects the chosen team can actually use', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.click(screen.getByTestId('quick-create-project'));

    expect(await screen.findByText('API market')).toBeTruthy();
    expect(screen.queryByText('Brand refresh')).toBeNull();
  });

  it('says which team the issue is going into', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.getByTestId('quick-create-crumb')).toHaveTextContent('ENG');
    expect(screen.getByTestId('quick-create-crumb')).toHaveTextContent('New issue');
  });

  it('offers a project and a sprint, which it could not before', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.getByTestId('quick-create-project')).toBeTruthy();
    expect(screen.getByTestId('quick-create-cycle')).toBeTruthy();
  });

  it('shows no formatting toolbar above the description, the way Linear does not', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.queryByTestId('quick-create-description-toolbar')).toBeNull();
  });

  it('offers to stay open for the next issue instead of a cancel button', () => {
    workspace = buildWorkspace();
    open();
    expect(screen.getByTestId('quick-create-more')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('carries the project and sprint that were actually chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Ship the thing');
    await user.click(screen.getByTestId('quick-create-project'));
    await user.click(await screen.findByText('API market'));
    await user.click(screen.getByTestId('quick-create-cycle'));
    await user.click(await screen.findByText('Sprint 3'));
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created).toHaveBeenCalledTimes(1);
    const input = created.mock.calls[0]?.[0];
    expect(input?.['title']).toBe('Ship the thing');
    expect(input?.['projectId']).toBe('proj_1');
    expect(input?.['cycleId']).toBe('cycle_1');
  });

  it('stays open and clears the title when Create more is on', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.click(screen.getByTestId('quick-create-more'));
    await user.type(screen.getByTestId('quick-create-title'), 'First one');
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('quick-create-title')).toHaveValue('');
    expect(screen.getByTestId('quick-create')).toBeTruthy();
  });

  it('drops the sprint and the project from the team that was left behind', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = {
      ...buildWorkspace(),
      teams: [
        { id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#fff' },
        { id: 'team_des', name: 'Design', key: 'DES', icon: 'd', color: '#eee' },
      ],
    };
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Moved teams');
    await user.click(screen.getByTestId('quick-create-project'));
    await user.click(await screen.findByText('API market'));
    await user.click(screen.getByTestId('quick-create-cycle'));
    await user.click(await screen.findByText('Sprint 3'));
    await user.click(screen.getByTestId('quick-create-team'));
    await user.click(await screen.findByText('Design'));
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]?.['cycleId']).toBeNull();
    expect(created.mock.calls[0]?.[0]?.['projectId']).toBeNull();
  });
});
