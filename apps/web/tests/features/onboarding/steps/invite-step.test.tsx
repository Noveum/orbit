import { afterEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteStep } from '@/features/onboarding/steps/invite-step.tsx';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('onboarding invitations', () => {
  it('does not discard an invalid teammate while sending the other invitations', async () => {
    const request = mock(() => Promise.resolve(Response.json({})));
    globalThis.fetch = request as unknown as typeof fetch;
    const onNext = mock();
    render(<InviteStep emailEnabled onNext={onNext} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Teammate 1 email'), 'valid@example.com');
    await user.type(screen.getByLabelText('Teammate 2 email'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Send invites' }));
    expect(
      screen.getByText('Correct the invalid email addresses before sending invitations.'),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('sends all filled rows and advances after a successful invitation batch', async () => {
    const onboarding = { completed: false, step: 'theme' };
    const request = mock(() => Promise.resolve(Response.json({ onboarding })));
    globalThis.fetch = request as unknown as typeof fetch;
    const onNext = mock();
    render(<InviteStep emailEnabled onNext={onNext} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Teammate 1 email'), 'one@example.com');
    await user.type(screen.getByLabelText('Teammate 3 email'), 'three@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invites' }));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(onboarding));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(
      '/api/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          invites: [
            { email: 'one@example.com', role: 'member' },
            { email: 'three@example.com', role: 'member' },
          ],
        }),
      }),
    );
  });

  it('continues onboarding without submitting unavailable email invitations', async () => {
    const onboarding = { completed: false, step: 'theme' };
    const request = mock(() => Promise.resolve(Response.json({ onboarding })));
    globalThis.fetch = request as unknown as typeof fetch;
    const onNext = mock();
    render(<InviteStep emailEnabled={false} onNext={onNext} />);
    expect(screen.queryByRole('button', { name: 'Send invites' })).toBeNull();
    expect(screen.queryByLabelText('Teammate 1 email')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(onboarding));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      '/api/onboarding',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ step: 'invite' }) }),
    );
  });
});
