import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  IntegrationPicker,
  type IntegrationPickerProps,
  type PickerItem,
} from '../../../src/features/settings/integration-picker.tsx';

const teams = [
  { id: 'team-1', key: 'ENG', name: 'Engineering' },
  { id: 'team-2', key: 'DES', name: 'Design' },
];

const items: PickerItem[] = [
  { id: '1', label: 'acme/web', linked: false },
  { id: '2', label: 'acme/api', linked: true },
  { id: '3', label: 'acme/docs', linked: false },
];

function props(overrides: Partial<IntegrationPickerProps> = {}): IntegrationPickerProps {
  return {
    open: true,
    onOpenChange: () => undefined,
    title: 'Link a repository',
    description: 'Search and map one to a team.',
    searchPlaceholder: 'Search repositories…',
    items,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: () => undefined,
    teams,
    submitLabel: 'Link',
    onSubmit: () => Promise.resolve(),
    ...overrides,
  };
}

describe('IntegrationPicker', () => {
  it('filters the list by the search query', async () => {
    const user = userEvent.setup();
    render(<IntegrationPicker {...props()} />);
    expect(screen.getByRole('button', { name: /acme\/web/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search'), 'api');
    expect(screen.queryByRole('button', { name: /acme\/web/ })).toBeNull();
    expect(screen.getByRole('button', { name: /acme\/api/ })).toBeInTheDocument();
  });

  it('links the selected item to the chosen team', async () => {
    const user = userEvent.setup();
    const onSubmit = mock((_item: PickerItem, _teamId: string | null) => Promise.resolve());
    render(<IntegrationPicker {...props({ onSubmit })} />);

    await user.click(screen.getByRole('button', { name: /acme\/web/ }));
    await user.selectOptions(screen.getByLabelText('Team'), 'team-2');
    await user.click(screen.getByRole('button', { name: 'Link' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const call = onSubmit.mock.calls[0];
    expect(call?.[0]?.id).toBe('1');
    expect(call?.[1]).toBe('team-2');
  });

  it('does not let an already linked item be selected', () => {
    render(<IntegrationPicker {...props()} />);
    expect(screen.getByRole('button', { name: /acme\/api/ })).toBeDisabled();
  });

  it('requests the next page from the load-more control', async () => {
    const user = userEvent.setup();
    const onLoadMore = mock();
    render(<IntegrationPicker {...props({ hasNextPage: true, onLoadMore })} />);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('passes a null team when workspace-wide is chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = mock((_item: PickerItem, _teamId: string | null) => Promise.resolve());
    render(
      <IntegrationPicker {...props({ allowWorkspace: true, submitLabel: 'Connect', onSubmit })} />,
    );

    await user.click(screen.getByRole('button', { name: /acme\/web/ }));
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[1]).toBeNull();
  });
});
