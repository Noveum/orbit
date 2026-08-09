import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setActive = mock();
const assign = mock();

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    organization: { setActive: (...args: unknown[]) => setActive(...args) },
  },
}));

const { WorkspaceDangerZone, formatDeletionBytes } = await import(
  '../../../src/features/settings/workspace-danger-zone.tsx'
);

const realFetch = globalThis.fetch;
const realLocation = window.location;

const summary = {
  organizationName: 'Nova',
  members: 2,
  teams: 3,
  projects: 4,
  issues: 15,
  documents: 6,
  files: 3,
  fileBytes: 1536,
  fileVersions: 5,
  fileVersionBytes: 2560,
  integrations: 1,
  webhooks: 2,
  availableAt: null,
  deletionRequestedAt: null,
};

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function installFetch(responses: Response[]): ReturnType<typeof mock> {
  const fetchMock = mock(() => {
    const next = responses.shift();
    if (next === undefined) throw new Error('Unexpected request');
    return Promise.resolve(next);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function openDialog(user = userEvent.setup()): Promise<typeof user> {
  await user.click(screen.getByRole('button', { name: 'Delete workspace' }));
  await screen.findByText('2 members');
  return user;
}

beforeEach(() => {
  setActive.mockReset();
  assign.mockClear();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Object.defineProperty(window, 'location', { value: realLocation, writable: true });
});

describe('formatDeletionBytes', () => {
  it('uses readable binary file sizes', () => {
    expect(formatDeletionBytes(0)).toBe('0 B');
    expect(formatDeletionBytes(1536)).toBe('1.5 KB');
  });
});

describe('WorkspaceDangerZone summary and confirmation', () => {
  it('shows every deletion category and requires an exact case-sensitive name', async () => {
    installFetch([response({ summary })]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);

    await openDialog(user);

    expect(screen.getByText('3 teams')).toBeVisible();
    expect(screen.getByText('4 projects')).toBeVisible();
    expect(screen.getByText('15 issues')).toBeVisible();
    expect(screen.getByText('6 documents')).toBeVisible();
    expect(screen.getByText('3 files')).toBeVisible();
    expect(screen.getByText('1.5 KB')).toBeVisible();
    expect(screen.getByText('5 stored file versions')).toBeVisible();
    expect(screen.getByText('2.5 KB')).toBeVisible();
    expect(screen.getByText('1 integration')).toBeVisible();
    expect(screen.getByText('2 webhooks')).toBeVisible();
    expect(screen.getByText('Comments, attachments, activity and settings')).toBeVisible();
    const confirm = screen.getByRole('button', { name: 'Permanently delete workspace' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Type Nova to confirm'), 'nova');
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText('Type Nova to confirm'));
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');
    expect(confirm).toBeEnabled();
  });

  it('loads a fresh summary each time the dialog opens', async () => {
    const fetchMock = installFetch([response({ summary }), response({ summary })]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await openDialog(user);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows the first confirmation to lock a workspace with protected upload links', async () => {
    installFetch([
      response({
        summary: { ...summary, availableAt: new Date(Date.now() + 60_000).toISOString() },
      }),
    ]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);

    await openDialog(user);
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    expect(screen.queryByText(/pending upload links and their completion window/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Permanently delete workspace' })).toBeEnabled();
  });

  it('keeps a pending deletion blocked until every upload capability has drained', async () => {
    installFetch([
      response({
        summary: {
          ...summary,
          availableAt: new Date(Date.now() + 60_000).toISOString(),
          deletionRequestedAt: new Date().toISOString(),
        },
      }),
    ]);
    const user = userEvent.setup();
    render(
      <WorkspaceDangerZone
        organizationName="Nova"
        deletionRequestedAt={new Date().toISOString()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Retry workspace deletion' }));
    await screen.findByText('2 members');
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    expect(screen.getByText(/pending upload links and their completion window/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry permanent deletion' })).toBeDisabled();
  });

  it('shows summary failures in an alert and retries in place', async () => {
    const fetchMock = installFetch([
      response({ error: { code: 'internal', message: 'Storage is unavailable.' } }, 500),
      response({ summary }),
    ]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);

    await user.click(screen.getByRole('button', { name: 'Delete workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage is unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('2 members')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('explains and resumes a durable deletion attempt', async () => {
    const requestedAt = '2026-08-08T13:00:00.000Z';
    installFetch([response({ summary: { ...summary, deletionRequestedAt: requestedAt } })]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" deletionRequestedAt={requestedAt} />);

    expect(screen.getByText(/Deletion is in progress/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry workspace deletion' }));
    await screen.findByText(/locked for normal use/);
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    expect(screen.getByRole('button', { name: 'Retry permanent deletion' })).toBeEnabled();
  });
});

describe('WorkspaceDangerZone deletion', () => {
  it('submits once, activates the next workspace, and leaves the deleted tenant', async () => {
    let resolveDelete: ((value: Response) => void) | undefined;
    const deleting = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    const fetchMock = mock()
      .mockResolvedValueOnce(response({ summary }))
      .mockImplementationOnce(() => deleting);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setActive.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);
    await openDialog(user);
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    const confirm = screen.getByRole('button', { name: 'Permanently delete workspace' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveDelete?.(
      response({ deletedOrganizationId: 'org_deleted', nextOrganizationId: 'org_next' }),
    );

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith({ organizationId: 'org_next' });
      expect(assign).toHaveBeenCalledWith('/my-issues');
    });
  });

  it('sends a user with no workspace left to workspace creation', async () => {
    installFetch([
      response({ summary }),
      response({ deletedOrganizationId: 'org_deleted', nextOrganizationId: null }),
    ]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);
    await openDialog(user);
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    await user.click(screen.getByRole('button', { name: 'Permanently delete workspace' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspaces/new'));
    expect(setActive).not.toHaveBeenCalled();
  });

  it('leaves deleted workspace state when activating the next workspace fails', async () => {
    installFetch([
      response({ summary }),
      response({ deletedOrganizationId: 'org_deleted', nextOrganizationId: 'org_next' }),
    ]);
    setActive.mockRejectedValue(new Error('session update failed'));
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);
    await openDialog(user);
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    await user.click(screen.getByRole('button', { name: 'Permanently delete workspace' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/workspaces/new'));
  });

  it('keeps the dialog open and reports a rejected deletion', async () => {
    installFetch([
      response({ summary }),
      response(
        {
          error: {
            code: 'conflict',
            message: 'Type the current workspace name exactly to confirm deletion.',
          },
        },
        409,
      ),
      response({ summary }),
    ]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);
    await openDialog(user);
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    await user.click(screen.getByRole('button', { name: 'Permanently delete workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Type the current workspace name exactly to confirm deletion.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(assign).not.toHaveBeenCalled();
  });

  it('refreshes into a locked retry state while upload capabilities drain', async () => {
    const availableAt = new Date(Date.now() + 60_000).toISOString();
    const requestedAt = new Date().toISOString();
    const fetchMock = installFetch([
      response({ summary }),
      response(
        {
          error: {
            code: 'conflict',
            message: 'Workspace deletion is pending while upload links expire.',
            details: { availableAt },
          },
        },
        409,
      ),
      response({
        summary: { ...summary, availableAt, deletionRequestedAt: requestedAt },
      }),
    ]);
    const user = userEvent.setup();
    render(<WorkspaceDangerZone organizationName="Nova" />);
    await openDialog(user);
    await user.type(screen.getByLabelText('Type Nova to confirm'), 'Nova');

    await user.click(screen.getByRole('button', { name: 'Permanently delete workspace' }));

    expect(await screen.findByText(/locked for normal use/)).toBeVisible();
    expect(screen.getByText(/pending upload links and their completion window/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry permanent deletion' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Workspace deletion is pending while upload links expire.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
