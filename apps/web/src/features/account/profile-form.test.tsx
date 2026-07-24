import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from './profile-form.tsx';

const refresh = mock();
const toast = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const realFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown): ReturnType<typeof mock> {
  const spy = mock(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderForm() {
  return render(
    <ProfileForm name="Pulkit Sharma" handle="pulkit" image={null} timezone="Asia/Kolkata" />,
  );
}

describe('ProfileForm', () => {
  it('sends the edited profile and refreshes', async () => {
    const fetchSpy = mockFetch(200, { user: { name: 'Pulkit S', handle: 'pulkit' } });
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Pulkit S');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      name: 'Pulkit S',
      handle: 'pulkit',
      timezone: 'Asia/Kolkata',
    });
    expect(body).not.toHaveProperty('image');
  });

  it('offers an upload control and no remove when there is no photo', () => {
    render(<ProfileForm name="Pulkit Sharma" handle="pulkit" image={null} timezone="UTC" />);

    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('removes the photo through the avatar endpoint', async () => {
    const fetchSpy = mockFetch(200, { user: { image: null } });
    const user = userEvent.setup();
    render(
      <ProfileForm
        name="Pulkit Sharma"
        handle="pulkit"
        image="/api/avatars/u1?v=1"
        timezone="UTC"
      />,
    );

    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('/api/account/avatar');
    expect(init.method).toBe('DELETE');
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('shows the handle conflict inline on the handle field', async () => {
    mockFetch(409, { error: { code: 'conflict', message: 'That handle is already taken.' } });
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText('Handle'));
    await user.type(screen.getByLabelText('Handle'), 'taken-handle');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That handle is already taken.');
    expect(screen.getByLabelText('Handle')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Handle')).toHaveAttribute(
      'aria-describedby',
      'profile-handle-error',
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports other failures without blaming the handle', async () => {
    mockFetch(500, { error: { code: 'internal', message: 'Something went wrong on our side.' } });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    expect(screen.getByLabelText('Handle')).toHaveAttribute('aria-invalid', 'false');
  });
});
