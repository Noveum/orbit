import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';

const pushes: string[] = [];

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => pushes.push(href),
    replace: () => undefined,
    prefetch: () => undefined,
    back: () => undefined,
    refresh: () => undefined,
  }),
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams(),
}));

const { NewProjectDialog } = await import('../../../src/features/projects/new-project-dialog.tsx');

const teams = [
  { id: 'team_eng', key: 'ENG', name: 'Engineering' },
  { id: 'team_dsgn', key: 'DSGN', name: 'Design' },
];

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const calls: Call[] = [];
const originalFetch = globalThis.fetch;
let failure: { status: number; code: string; message: string } | null = null;

function stubFetch(): void {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const body: Record<string, unknown> =
      typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ url: String(input), method: init?.method ?? 'GET', body });
    if (failure !== null) {
      return Promise.resolve(
        Response.json(
          { error: { code: failure.code, message: failure.message } },
          { status: failure.status },
        ),
      );
    }
    return Promise.resolve(
      Response.json({
        project: {
          id: 'project_new',
          slug: 'realtime-delta-protocol',
          name: String(body['name']),
        },
      }),
    );
  }) as unknown as typeof fetch;
}

function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function mountDialog(canManage = true) {
  render(
    <Providers>
      <NewProjectDialog teams={teams} canManage={canManage} />
    </Providers>,
  );
}

async function openAndName(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByTestId('new-project'));
  await screen.findByTestId('new-project-dialog');
  await user.type(screen.getByTestId('new-project-name'), name);
}

beforeEach(() => {
  calls.length = 0;
  pushes.length = 0;
  failure = null;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('NewProjectDialog', () => {
  it('posts the draft to the projects route and follows the slug the server picked', async () => {
    const user = userEvent.setup();
    mountDialog();

    await openAndName(user, 'Realtime delta protocol');
    await user.click(screen.getByTestId('new-project-team-ENG'));
    await user.click(screen.getByTestId('new-project-submit'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: '/api/projects', method: 'POST' });
    expect(calls[0]?.body).toMatchObject({
      name: 'Realtime delta protocol',
      teamIds: ['team_eng'],
      targetDate: null,
    });
    await waitFor(() => expect(pushes).toEqual(['/projects/realtime-delta-protocol']));
  });

  it('sends no slug of its own, so the server is the one that names the address', async () => {
    const user = userEvent.setup();
    mountDialog();

    await openAndName(user, 'Realtime delta protocol');
    await user.click(screen.getByTestId('new-project-submit'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(Object.keys(calls[0]?.body ?? {}).sort()).toEqual([
      'name',
      'summary',
      'targetDate',
      'teamIds',
    ]);
  });

  it('shows the reason the server refused and stays put', async () => {
    failure = { status: 403, code: 'forbidden', message: 'Your role cannot project manage.' };
    const user = userEvent.setup();
    mountDialog();

    await openAndName(user, 'Refused project');
    await user.click(screen.getByTestId('new-project-submit'));

    expect(await screen.findByTestId('new-project-error')).toHaveTextContent(
      'Your role cannot project manage.',
    );
    expect(pushes).toEqual([]);
  });

  it('will not submit a name shorter than the server accepts', async () => {
    const user = userEvent.setup();
    mountDialog();

    await openAndName(user, 'a');

    expect(screen.getByTestId('new-project-submit')).toBeDisabled();
    expect(calls).toEqual([]);
  });

  it('offers nothing at all to somebody who cannot manage projects', () => {
    mountDialog(false);

    expect(screen.queryByTestId('new-project')).toBeNull();
  });
});
