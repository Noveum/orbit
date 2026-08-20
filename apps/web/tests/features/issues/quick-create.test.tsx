import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
    isPending: false,
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
      {
        id: 'reviewer_2',
        name: 'Ada Reviewer',
        email: 'ada@x.co',
        image: null,
        handle: 'ada',
        role: 'member',
      },
    ],
    labels: [{ id: 'label_bug', teamId: 'team_eng', name: 'Bug', color: '#f00' }],
    projects: [
      {
        id: 'proj_1',
        slug: 'proj-1',
        name: 'API market',
        status: 'started',
        color: '#00f',
        icon: 'box',
        teamIds: ['team_eng'],
      },
      {
        id: 'proj_2',
        slug: 'proj-2',
        name: 'Brand refresh',
        status: 'started',
        color: '#0f0',
        icon: 'box',
        teamIds: ['team_des'],
      },
      {
        id: 'proj_3',
        slug: 'proj-3',
        name: 'Company launch',
        status: 'started',
        color: '#f0f',
        icon: 'box',
        teamIds: [],
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

function buildWorkspaceWithDesign(): WorkspaceData {
  return {
    ...buildWorkspace(),
    teams: [
      { id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#fff' },
      { id: 'team_des', name: 'Design', key: 'DES', icon: 'd', color: '#eee' },
    ],
  };
}

const realFetch = globalThis.fetch;
const realXhr = globalThis.XMLHttpRequest;

afterEach(() => {
  cleanup();
  created.mockClear();
  patched.mockClear();
  inFlight.defer = false;
  inFlight.resume = null;
  inFlight.pending = false;
  globalThis.fetch = realFetch;
  globalThis.XMLHttpRequest = realXhr;
});

function DialogHarness({
  onOpenChange,
  defaultTeamId,
}: {
  readonly onOpenChange: ((next: boolean) => void) | undefined;
  readonly defaultTeamId: string | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <QuickCreateDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
      defaultTeamId={defaultTeamId}
    />
  );
}

function dialog(onOpenChange?: (next: boolean) => void, defaultTeamId: string | null = 'team_eng') {
  return (
    <ToastProvider>
      <DialogHarness onOpenChange={onOpenChange} defaultTeamId={defaultTeamId} />
    </ToastProvider>
  );
}

function open(onOpenChange?: (next: boolean) => void, defaultTeamId: string | null = 'team_eng') {
  return render(dialog(onOpenChange, defaultTeamId));
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

  it('does not start a second create from repeated Meta+Enter while the first is in flight', async () => {
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

    act(() => inFlight.resume?.());
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
  it('creates an issue with multiple reviewers from the new field', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Review the release');
    await user.click(screen.getByTestId('quick-create-reviewers'));
    await user.click(await screen.findByText('Shashank'));
    await user.click(await screen.findByText('Ada Reviewer'));
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]).toMatchObject({
      reviewerIds: ['me', 'reviewer_2'],
    });
  });

  it('caps reviewers at fifty while keeping removal available', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = {
      ...buildWorkspace(),
      members: Array.from({ length: 51 }, (_value, index) => ({
        id: `reviewer_${index + 1}`,
        name: `Reviewer ${index + 1}`,
        email: `reviewer-${index + 1}@orbit.test`,
        image: null,
        handle: `reviewer-${index + 1}`,
        role: 'member',
      })),
    };
    open();

    const trigger = screen.getByTestId('quick-create-reviewers');
    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    for (let index = 1; index <= 50; index += 1) {
      await user.click(within(menu).getByText(`Reviewer ${index}`));
    }
    await waitFor(() => expect(trigger).toHaveTextContent('50 reviewers'));

    const blocked = within(menu).getByText('Reviewer 51').closest('[role="menuitemcheckbox"]');
    const removable = within(menu).getByText('Reviewer 1').closest('[role="menuitemcheckbox"]');
    if (blocked === null || removable === null) throw new Error('missing reviewer option');

    expect(blocked).toHaveAttribute('data-disabled');
    await user.click(blocked);
    expect(trigger).toHaveTextContent('50 reviewers');

    await user.click(removable);
    await waitFor(() => expect(trigger).toHaveTextContent('49 reviewers'));
  });

  it('offers every accessible project from every team', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspaceWithDesign();
    open();

    await user.click(screen.getByTestId('quick-create-project'));

    expect(await screen.findByText('API market')).toBeTruthy();
    expect(screen.getByText('Company launch')).toBeTruthy();
    expect(screen.getByText('Brand refresh')).toBeTruthy();
  });

  it('moves the issue to a compatible team when another team project is chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspaceWithDesign();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Refresh the brand');
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(await screen.findByText('Todo'));
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    await user.click(await screen.findByText('Bug'));
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('quick-create-estimate'));
    await user.click(await screen.findByText('5 points'));
    await user.click(screen.getByTestId('quick-create-cycle'));
    await user.click(await screen.findByText('Sprint 3'));
    const projectTrigger = screen.getByTestId('quick-create-project');
    projectTrigger.focus();
    await user.keyboard('{Enter}Brand{Enter}');

    expect(screen.getByTestId('quick-create-crumb')).toHaveTextContent('DES');
    await user.click(screen.getByTestId('quick-create-submit'));
    expect(created.mock.calls[0]?.[0]).toMatchObject({
      teamId: 'team_des',
      projectId: 'proj_2',
      cycleId: 'cycle_1',
      estimate: null,
      labelIds: [],
    });
    expect(created.mock.calls[0]?.[0]?.['stateId']).toBeUndefined();
  });

  it('focuses the title when it opens', () => {
    workspace = buildWorkspace();
    open();

    expect(screen.getByTestId('quick-create-title')).toHaveFocus();
  });

  it('chooses a project using only the keyboard', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();
    const trigger = screen.getByTestId('quick-create-project');

    trigger.focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');

    expect(trigger).toHaveTextContent('API market');
  });

  it('jumps to a project by typing its name', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();
    const trigger = screen.getByTestId('quick-create-project');

    trigger.focus();
    await user.keyboard('{Enter}Company{Enter}');

    expect(trigger).toHaveTextContent('Company launch');
  });

  it('closes the project menu before it closes the dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const changed = mock((_next: boolean) => undefined);
    workspace = buildWorkspace();
    open(changed);
    const trigger = screen.getByTestId('quick-create-project');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(changed).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(changed).toHaveBeenCalledWith(false);
  });

  it('creates with Ctrl+Enter on Windows and Linux', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Keyboard issue');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0]?.[0]?.['title']).toBe('Keyboard issue');
  });

  it('does not create from an unmodified Enter in the title', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Still drafting{Enter}');

    expect(created).not.toHaveBeenCalled();
  });

  it('lets an IME use Enter to confirm a title candidate', () => {
    workspace = buildWorkspace();
    open();

    expect(
      fireEvent.keyDown(screen.getByTestId('quick-create-title'), {
        key: 'Enter',
        isComposing: true,
      }),
    ).toBe(true);
  });

  it('does not submit a title while an IME composition is active', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();
    const title = screen.getByTestId('quick-create-title');

    await user.type(title, 'Composing');
    fireEvent.keyDown(title, { key: 'Enter', metaKey: true, isComposing: true });

    expect(created).not.toHaveBeenCalled();
  });

  it('adopts the first available team when workspace data arrives after opening', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = { ...buildWorkspace(), ready: false, teams: [] };
    const mounted = open(() => undefined, null);

    workspace = buildWorkspace();
    mounted.rerender(dialog(() => undefined, null));
    await user.type(screen.getByTestId('quick-create-title'), 'Loaded later');
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]?.['teamId']).toBe('team_eng');
  });

  it('clears team-scoped choices when the selected team disappears', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = {
      ...buildWorkspace(),
      teams: [
        { id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#fff' },
        { id: 'team_des', name: 'Design', key: 'DES', icon: 'd', color: '#eee' },
      ],
    };
    const mounted = open();

    await user.type(screen.getByTestId('quick-create-title'), 'Recovered team');
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(await screen.findByText('Todo'));
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    await user.click(await screen.findByText('Bug'));
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('quick-create-project'));
    await user.click(await screen.findByText('API market'));
    await user.click(screen.getByTestId('quick-create-estimate'));
    await user.click(await screen.findByText('5 points'));
    await user.click(screen.getByTestId('quick-create-cycle'));
    await user.click(await screen.findByText('Sprint 3'));

    workspace = {
      ...workspace,
      teams: workspace.teams.filter((team) => team.id === 'team_des'),
    };
    await act(async () => {
      mounted.rerender(dialog());
      await Promise.resolve();
    });
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]).toMatchObject({
      teamId: 'team_des',
      projectId: null,
      cycleId: 'cycle_1',
      estimate: null,
      labelIds: [],
    });
    expect(created.mock.calls[0]?.[0]?.['stateId']).toBeUndefined();
  });

  it('does not submit plain Enter in the description and submits there with Ctrl+Enter', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();
    await user.type(screen.getByTestId('quick-create-title'), 'Documented issue');
    const editor = screen
      .getByTestId('quick-create-description')
      .querySelector<HTMLElement>('[contenteditable="true"]');
    if (editor === null) throw new Error('no description editor');

    await user.click(editor);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(editor.querySelectorAll('p')).toHaveLength(2));
    expect(created).not.toHaveBeenCalled();

    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(created).toHaveBeenCalledTimes(1);
  });

  it('clears a project that becomes unavailable while the dialog is open', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    const mounted = open();

    await user.click(screen.getByTestId('quick-create-project'));
    await user.click(await screen.findByText('API market'));
    workspace = {
      ...workspace,
      projects: workspace.projects.filter((project) => project.id !== 'proj_1'),
    };
    mounted.rerender(dialog());
    await user.type(screen.getByTestId('quick-create-title'), 'Still valid');
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]?.['projectId']).toBeNull();
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

  it('scrolls the description instead of pushing the submit button past the viewport', () => {
    workspace = buildWorkspace();
    open();

    const scroller = screen.getByTestId('quick-create-scroll');
    const submit = screen.getByTestId('quick-create-submit');

    expect(scroller).toContainElement(screen.getByTestId('quick-create-description'));
    expect(scroller).toContainElement(screen.getByTestId('quick-create-project'));
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.contains(submit)).toBe(false);
    expect(screen.getByTestId('quick-create').className).toContain('max-h-');
  });

  it('holds the description at its natural height so it cannot cover the properties', () => {
    workspace = buildWorkspace();
    open();

    expect(screen.getByTestId('quick-create-description').className).toContain('shrink-0');
    expect(screen.getByTestId('quick-create-properties').className).toContain('shrink-0');
    expect(screen.getByTestId('quick-create-title').className).toContain('shrink-0');
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
    expect(screen.getByTestId('quick-create-title')).toHaveFocus();
    expect(screen.getByTestId('quick-create')).toBeTruthy();
  });

  it('keeps a workspace project when the team changes', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = {
      ...buildWorkspace(),
      teams: [
        { id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'e', color: '#fff' },
        { id: 'team_des', name: 'Design', key: 'DES', icon: 'd', color: '#eee' },
      ],
    };
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Company work');
    await user.click(screen.getByTestId('quick-create-project'));
    await user.click(await screen.findByText('Company launch'));
    await user.click(screen.getByTestId('quick-create-team'));
    await user.click(await screen.findByText('Design'));
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]?.['projectId']).toBe('proj_3');
  });

  it('keeps the sprint but drops the project from the team that was left behind', async () => {
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

    expect(created.mock.calls[0]?.[0]?.['cycleId']).toBe('cycle_1');
    expect(created.mock.calls[0]?.[0]?.['projectId']).toBeNull();
  });
});

describe('the pickers when the workspace owns nothing yet', () => {
  it('says the workspace has no projects rather than showing an empty menu', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = { ...buildWorkspace(), projects: [] };
    open();

    await user.click(screen.getByTestId('quick-create-project'));

    expect(await screen.findByText('No projects in this workspace')).toBeTruthy();
  });

  it('says the workspace has no sprints rather than showing an empty menu', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = { ...buildWorkspace(), cycles: [] };
    open();

    await user.click(screen.getByTestId('quick-create-cycle'));

    expect(await screen.findByText('No sprints yet')).toBeTruthy();
  });
});

describe('story points on a new issue', () => {
  it('sends the points that were chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Sized work');
    await user.click(screen.getByTestId('quick-create-estimate'));
    await user.click(await screen.findByText('5 points'));
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]?.['estimate']).toBe(5);
  });

  it('sends no estimate when none was chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.type(screen.getByTestId('quick-create-title'), 'Unsized work');
    await user.click(screen.getByTestId('quick-create-submit'));

    expect(created.mock.calls[0]?.[0]?.['estimate']).toBeNull();
  });
});

describe('the property chips on the new issue dialog', () => {
  it('gives every chip a glyph, so the row does not read as one icon and six words', () => {
    workspace = buildWorkspace();
    open();

    const chips = [
      'quick-create-status',
      'quick-create-assignee',
      'quick-create-labels',
      'quick-create-project',
      'quick-create-estimate',
      'quick-create-cycle',
    ];

    for (const chip of chips) {
      const leading = screen.getByTestId(chip).firstElementChild;
      expect(leading?.tagName.toLowerCase()).toMatch(/^(svg|span)$/);
      expect(leading?.textContent).toBe('');
    }
  });

  it('swaps the status placeholder for the state glyph once a status is chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    const chip = screen.getByTestId('quick-create-status');
    expect(chip.querySelector('svg')).toBeNull();

    await user.click(chip);
    await user.click(await screen.findByText('Todo'));

    expect(screen.getByTestId('quick-create-status')).toHaveTextContent('Todo');
    expect(screen.getByTestId('quick-create-status').querySelector('svg')).not.toBeNull();
  });

  it('swaps the assignee placeholder for an avatar once someone is assigned', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    const chip = screen.getByTestId('quick-create-assignee');
    expect(chip.querySelector('[aria-label="Shashank"]')).toBeNull();

    await user.click(chip);
    await user.click(await screen.findByText('Shashank'));

    const assigned = screen.getByTestId('quick-create-assignee');
    expect(assigned).toHaveTextContent('Shashank');
    expect(assigned.querySelector('[aria-label="Shashank"]')).not.toBeNull();
  });

  it('reads the estimate chip in the singular at one point', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.click(screen.getByTestId('quick-create-estimate'));
    await user.click(await screen.findByText('1 point'));

    expect(screen.getByTestId('quick-create-estimate')).toHaveTextContent(/^1 point$/);
  });

  it('announces a chip once, not twice, when the glyph repeats the visible text', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    workspace = buildWorkspace();
    open();

    await user.click(screen.getByTestId('quick-create-estimate'));
    await user.click(await screen.findByText('3 points'));

    expect(screen.getByRole('button', { name: '3 points' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3 points 3 points' })).toBeNull();
  });

  it('still shows no formatting toolbar above the description', () => {
    workspace = buildWorkspace();
    open();

    expect(screen.queryByTestId('quick-create-description-toolbar')).toBeNull();
  });
});
