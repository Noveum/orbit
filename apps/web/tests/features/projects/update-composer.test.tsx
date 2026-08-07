import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';

const refreshes: number[] = [];

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => undefined,
    back: () => undefined,
    refresh: () => refreshes.push(1),
  }),
  usePathname: () => '/projects/launch',
  useSearchParams: () => new URLSearchParams(),
}));

const { UpdateComposer } = await import('../../../src/features/projects/update-composer.tsx');

interface PostedUpdate {
  readonly health: string;
  readonly body: string;
}

const posted: PostedUpdate[] = [];
const originalFetch = globalThis.fetch;

function stubFetch(): void {
  globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body === 'string') posted.push(JSON.parse(init.body) as PostedUpdate);
    return Promise.resolve(Response.json({ update: { id: 'update_1' } }));
  }) as unknown as typeof fetch;
}

function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function editorText(): string {
  return screen.getByTestId('project-update-body').textContent ?? '';
}

async function writeAndPost(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.click(screen.getByRole('textbox', { name: 'Project update' }));
  await user.paste(text);
  await waitFor(() => expect(editorText()).toBe(text));
  const submit = screen.getByRole('button', { name: /Post update|Posting/ });
  await waitFor(() => expect(submit).not.toBeDisabled());
  await user.click(submit);
}

beforeEach(() => {
  posted.length = 0;
  refreshes.length = 0;
  stubFetch();
  render(
    <Providers>
      <UpdateComposer projectId="project_launch" currentHealth="on_track" canPost />
    </Providers>,
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('UpdateComposer', () => {
  it('posts what was written and empties the editor afterwards', async () => {
    const user = userEvent.setup();

    await writeAndPost(user, 'Shipped the importer');

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toContain('Shipped the importer');
    expect(posted[0]?.health).toBe('on_track');
    await waitFor(() => expect(editorText()).toBe(''));
    expect(refreshes).toHaveLength(1);
  });

  it('does not carry the posted text into the next update', async () => {
    const user = userEvent.setup();

    await writeAndPost(user, 'Shipped the importer');
    await waitFor(() => expect(posted).toHaveLength(1));
    await waitFor(() => expect(editorText()).toBe(''));

    await writeAndPost(user, 'Started the socket');

    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.body).toContain('Started the socket');
    expect(posted[1]?.body).not.toContain('Shipped the importer');
  });

  it('will not post an empty update', () => {
    expect(screen.getByRole('button', { name: 'Post update' })).toBeDisabled();
    expect(posted).toEqual([]);
  });
});
