import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuplicateSuggestions } from '@/features/issues/duplicate-suggestions.tsx';

describe('DuplicateSuggestions', () => {
  it('renders nothing when duplicates list is empty', () => {
    const { container } = render(
      <DuplicateSuggestions duplicates={[]} onDismiss={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders similar issues with identifier, title link, and state', () => {
    const duplicates = [
      {
        id: 'iss_1',
        identifier: 'ENG-10',
        title: 'Safari passkey failure',
        state: {
          id: 'st_1',
          name: 'In Progress',
          category: 'started',
          color: '#f59e0b',
        },
        similarity: 0.85,
      },
      {
        id: 'iss_2',
        identifier: 'ENG-12',
        title: 'Passkey login broken on Safari',
        state: {
          id: 'st_2',
          name: 'Done',
          category: 'completed',
          color: '#10b981',
        },
        similarity: 0.72,
      },
    ];

    render(<DuplicateSuggestions duplicates={duplicates} onDismiss={() => undefined} />);

    expect(screen.getByTestId('duplicate-suggestions')).toBeInTheDocument();
    expect(screen.getByText('Similar existing issues (2)')).toBeInTheDocument();
    expect(screen.getByText('ENG-10')).toBeInTheDocument();
    expect(screen.getByText('Safari passkey failure')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('ENG-12')).toBeInTheDocument();
    expect(screen.getByText('Passkey login broken on Safari')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Safari passkey failure/i });
    expect(link).toHaveAttribute('href', '/issues/ENG-10');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('calls onDismiss when the close button is clicked', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onDismiss = mock(() => undefined);
    const duplicates = [
      {
        id: 'iss_1',
        identifier: 'ENG-10',
        title: 'Safari passkey failure',
        state: {
          id: 'st_1',
          name: 'In Progress',
          category: 'started',
          color: '#f59e0b',
        },
        similarity: 0.85,
      },
    ];

    render(<DuplicateSuggestions duplicates={duplicates} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss similar issues' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
