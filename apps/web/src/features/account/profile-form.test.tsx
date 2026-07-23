import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileForm } from './profile-form.tsx';

const refresh = vi.fn();
const toast = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}));

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(JSON.parse(init.body)).toMatchObject({
      name: 'Pulkit S',
      handle: 'pulkit',
      image: null,
      timezone: 'Asia/Kolkata',
    });
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
