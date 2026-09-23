import { afterEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupCopyValue } from '@/features/settings/setup-copy-value.tsx';

const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  if (clipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard');
  else Object.defineProperty(navigator, 'clipboard', clipboard);
});

describe('setup copy values', () => {
  it('copies the full displayed value and confirms success', async () => {
    const user = userEvent.setup();
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const value = 'SLACK_ENABLED=false\nSLACK_CLIENT_ID=<your-client-id>';
    render(<SetupCopyValue label="Slack environment template" value={value} />);
    await user.click(screen.getByRole('button', { name: 'Copy Slack environment template' }));
    expect(writeText).toHaveBeenCalledWith(value);
    expect(screen.getByRole('status')).toHaveTextContent('Copied.');
  });

  it('keeps the value available when clipboard permission is denied', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Permission denied')) },
    });
    render(
      <SetupCopyValue
        label="Slack OAuth redirect URL"
        value="https://orbit.example.com/callback"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy Slack OAuth redirect URL' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not copy. Select and copy the text below.',
    );
    expect(screen.getByText('https://orbit.example.com/callback')).toBeInTheDocument();
  });
});
