import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { DuplicateProjectDialog } from '../../../src/features/projects/duplicate-project-dialog.tsx';

const pushes: string[] = [];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => pushes.push(href),
    replace: () => undefined,
    prefetch: () => undefined,
    back: () => undefined,
    refresh: () => undefined,
  }),
  usePathname: () => '/projects/platform',
  useSearchParams: () => new URLSearchParams(),
}));

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
          id: 'project_copy',
          slug: 'platform-copy',
          name: String(body['name'] ?? 'Platform (copy)'),
        },
      }),
    );
  }) as unknown as typeof fetch;
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function mountDialog(canManage = true) {
  render(
    <Providers>
      <DuplicateProjectDialog
        projectId="project_source"
        projectName="Platform"
        canManage={canManage}
      />
    </Providers>,
  );
}

beforeEach(() => {
  calls.length = 0;
  pushes.length = 0;
  failure = null;
  queryClient.clear();
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('DuplicateProjectDialog', () => {
  it('hides when caller cannot manage projects', () => {
    mountDialog(false);
    expect(screen.queryByTestId('duplicate-project-trigger')).toBeNull();
  });

  it('renders trigger when caller can manage projects', () => {
    mountDialog(true);
    expect(screen.getByTestId('duplicate-project-trigger')).toBeDefined();
  });

  it('opens with default values and submits duplication', async () => {
    const user = userEvent.setup();
    mountDialog(true);

    await user.click(screen.getByTestId('duplicate-project-trigger'));

    const nameInput = screen.getByTestId('duplicate-project-name');
    expect((nameInput as HTMLInputElement).value).toBe('Platform (copy)');

    const shiftInput = screen.getByTestId('duplicate-project-shift-days');
    expect((shiftInput as HTMLInputElement).value).toBe('0');

    const issuesInput = screen.getByTestId('duplicate-project-include-issues');
    expect((issuesInput as HTMLInputElement).checked).toBe(true);

    await user.clear(shiftInput);
    await user.type(shiftInput, '14');

    await user.click(screen.getByTestId('duplicate-project-submit'));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    expect(calls[0]?.url).toBe('/api/projects/project_source/duplicate');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({
      name: 'Platform (copy)',
      shiftDays: 14,
      includeIssues: true,
    });

    expect(pushes).toEqual(['/projects/platform-copy']);
  });

  it('allows unticking issues', async () => {
    const user = userEvent.setup();
    mountDialog(true);

    await user.click(screen.getByTestId('duplicate-project-trigger'));
    await user.click(screen.getByTestId('duplicate-project-include-issues'));
    await user.click(screen.getByTestId('duplicate-project-submit'));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    expect(calls[0]?.body['includeIssues']).toBe(false);
  });

  it('shows error message on failure', async () => {
    failure = { status: 400, code: 'bad_request', message: 'Name too long' };
    const user = userEvent.setup();
    mountDialog(true);

    await user.click(screen.getByTestId('duplicate-project-trigger'));
    await user.click(screen.getByTestId('duplicate-project-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-project-error')).toBeDefined();
    });

    expect(screen.getByTestId('duplicate-project-error').textContent).toBe('Name too long');
    expect(pushes).toHaveLength(0);
  });

  it('supports negative date shift input', async () => {
    const user = userEvent.setup();
    mountDialog(true);

    await user.click(screen.getByTestId('duplicate-project-trigger'));

    const shiftInput = screen.getByTestId('duplicate-project-shift-days');
    await user.clear(shiftInput);
    await user.type(shiftInput, '-7');

    await user.click(screen.getByTestId('duplicate-project-submit'));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    expect(calls[0]?.body['shiftDays']).toBe(-7);
  });
});
