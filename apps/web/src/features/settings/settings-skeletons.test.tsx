import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import {
  GeneralSettingsSkeleton,
  IntegrationsSettingsSkeleton,
  MembersSettingsSkeleton,
  NotificationsSettingsSkeleton,
  TeamsSettingsSkeleton,
} from './settings-skeletons.tsx';

describe('settings skeletons', () => {
  it('renders the general settings skeleton', () => {
    const { getByTestId } = render(<GeneralSettingsSkeleton />);
    expect(getByTestId('settings-general-skeleton')).toBeInTheDocument();
  });

  it('renders the integrations settings skeleton', () => {
    const { getByTestId } = render(<IntegrationsSettingsSkeleton />);
    expect(getByTestId('settings-integrations-skeleton')).toBeInTheDocument();
  });

  it('renders the teams settings skeleton', () => {
    const { getByTestId } = render(<TeamsSettingsSkeleton />);
    expect(getByTestId('settings-teams-skeleton')).toBeInTheDocument();
  });

  it('renders the members settings skeleton', () => {
    const { getByTestId } = render(<MembersSettingsSkeleton />);
    expect(getByTestId('settings-members-skeleton')).toBeInTheDocument();
  });

  it('renders the notifications settings skeleton', () => {
    const { getByTestId } = render(<NotificationsSettingsSkeleton />);
    expect(getByTestId('settings-notifications-skeleton')).toBeInTheDocument();
  });
});
