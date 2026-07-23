import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateWorkspaceForm } from './create-workspace-form.tsx';

const push = vi.fn();
const refresh = vi.fn();
const setActive = vi.fn();
const assign = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, back: vi.fn() }),
}));

vi.mock('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/lib/auth/client.ts', () => ({
  authClient: {
    organization: { setActive: (...args: unknown[]) => setActive(...args) },
  },
}));

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  setActive.mockReset();
  assign.mockClear();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreateWorkspaceForm', () => {
  it('suggests a slug from the name and lets the user override it', async () => {
    const user = userEvent.setup();
    render(<CreateWorkspaceForm />);

    await user.type(screen.getByLabelText('Workspace name'), 'Noveum Labs');
    expect(screen.getByLabelText('Workspace address')).toHaveValue('noveum-labs');

    await user.clear(screen.getByLabelText('Workspace address'));
    await user.type(screen.getByLabelText('Workspace address'), 'nl');
    await user.type(screen.getByLabelText('Workspace name'), ' Two');
    expect(screen.getByLabelText('Workspace address')).toHaveValue('nl');
  });

  it('creates the workspace, switches to it, and lands on its board', async () => {
    setActive.mockResolvedValue({ error: null });
    const fetchSpy = mockFetch(200, {
      organization: { id: 'org-9', slug: 'noveum-labs' },
      team: { key: 'NL' },
    });
    const user = userEvent.setup();
    render(<CreateWorkspaceForm />);

    await user.type(screen.getByLabelText('Workspace name'), 'Noveum Labs');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith({ organizationId: 'org-9' });
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/api/organizations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Noveum Labs', slug: 'noveum-labs' });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/team/nl/board');
    });
  });

  it('keeps the submit disabled until the name and slug are valid', async () => {
    const user = userEvent.setup();
    render(<CreateWorkspaceForm />);

    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
    await user.type(screen.getByLabelText('Workspace name'), 'Ok');
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  });

  it('surfaces a taken address from the server', async () => {
    mockFetch(409, {
      error: { code: 'conflict', message: 'That workspace address is already taken.' },
    });
    const user = userEvent.setup();
    render(<CreateWorkspaceForm />);

    await user.type(screen.getByLabelText('Workspace name'), 'Noveum');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That workspace address is already taken.',
    );
    expect(setActive).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
