import { describe, expect, it, mock } from 'bun:test';
import type { Principal } from '@orbit/shared/policy';

const dbModule = await import('@orbit/db');
mock.module('@orbit/db', () => ({
  ...dbModule,
  db: { execute: () => Promise.resolve([{ version: '5' }]) },
}));

const { bootstrapVersion } = await import('./bootstrap.ts');

function member(userId: string, organizationId = 'org_shared'): Principal {
  return { userId, organizationId, role: 'admin', teamIds: ['team_1'] };
}

describe('bootstrapVersion keeps the weak etag user scoped', () => {
  it('never hands two members of one org the same bootstrap etag version', async () => {
    const admin = await bootstrapVersion(member('user_admin'));
    const teammate = await bootstrapVersion(member('user_teammate'));

    expect(admin).not.toBe(teammate);
    expect(admin.startsWith('user_admin')).toBe(true);
    expect(teammate.startsWith('user_teammate')).toBe(true);
  });

  it('separates the same user across two organizations at the same sync id', async () => {
    const inOrgA = await bootstrapVersion(member('user_multi', 'org_a'));
    const inOrgB = await bootstrapVersion(member('user_multi', 'org_b'));

    expect(inOrgA).not.toBe(inOrgB);
    expect(inOrgA.includes('org_a')).toBe(true);
    expect(inOrgB.includes('org_b')).toBe(true);
  });
});
