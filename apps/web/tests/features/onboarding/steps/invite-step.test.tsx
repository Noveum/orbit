import { afterEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteStep } from '@/features/onboarding/steps/invite-step.tsx';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('onboarding invitations', () => {
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
