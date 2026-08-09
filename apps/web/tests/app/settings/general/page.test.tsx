import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Principal } from '@orbit/shared/policy';
import { render, screen } from '@testing-library/react';

const coreModule = await import('@orbit/core');
const handlerModule = await import('@/lib/api/handler.ts');

let principal: Principal;
let deletionRequestedAt: Date | null;

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: mock(), push: mock(), back: mock() }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

mock.module('@orbit/core', () => ({
  ...coreModule,
  getOrganization: () =>
    Promise.resolve({
      id: 'org_nova',
      name: 'Nova',
      logo: null,
      allowedEmailDomains: [],
    }),
}));

mock.module('@/lib/api/handler.ts', () => ({
  ...handlerModule,
  pageContext: () =>
    Promise.resolve({
      principal,
      memberId: 'member_1',
      organizationName: 'Nova',
      organizationSlug: 'nova',
      deletionRequestedAt,
      userName: 'Person',
      userEmail: 'person@orbit.test',
    }),
}));

const { default: GeneralSettingsPage } = await import(
  '../../../../src/app/(app)/settings/general/page.tsx'
);

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
  mock.module('@/lib/api/handler.ts', () => handlerModule);
});

beforeEach(() => {
  deletionRequestedAt = null;
  principal = {
    userId: 'user_1',
    organizationId: 'org_nova',
    role: 'admin',
    teamIds: [],
  };
});

describe('GeneralSettingsPage workspace deletion permission', () => {
  it('shows the danger zone to an administrator', async () => {
    render(await GeneralSettingsPage());

    expect(screen.getByRole('button', { name: 'Delete workspace' })).toBeVisible();
  });

  it('does not reveal workspace deletion controls to a member', async () => {
    principal = { ...principal, role: 'member' };

    render(await GeneralSettingsPage());

    expect(screen.queryByRole('button', { name: 'Delete workspace' })).toBeNull();
  });

  it('limits a pending workspace to resuming its deletion', async () => {
    deletionRequestedAt = new Date('2026-08-08T13:00:00.000Z');

    render(await GeneralSettingsPage());

    expect(screen.getByRole('button', { name: 'Retry workspace deletion' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});
