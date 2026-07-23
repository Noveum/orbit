import { describe, expect, it } from 'bun:test';
import type { OrgRole } from '../constants/index.ts';
import { DomainError } from '../errors/index.ts';
import {
  assertCan,
  assertInTeam,
  atLeast,
  can,
  canAssignRole,
  isInTeam,
  type Principal,
  permissionsFor,
} from './index.ts';

function principal(role: OrgRole, teamIds: string[] = ['team_eng']): Principal {
  return { userId: 'user_1', organizationId: 'org_1', role, teamIds };
}

describe('permissionsFor', () => {
  it('widens monotonically from guest to admin', () => {
    const guest = permissionsFor('guest');
    const contributor = permissionsFor('contributor');
    const member = permissionsFor('member');
    const admin = permissionsFor('admin');

    for (const permission of guest) expect(contributor).toContain(permission);
    for (const permission of contributor) expect(member).toContain(permission);
    for (const permission of member) expect(admin).toContain(permission);
    expect(admin.length).toBeGreaterThan(guest.length);
  });
});

describe('can', () => {
  it('lets a guest read but not create issues', () => {
    expect(can(principal('guest'), 'issue:read')).toBe(true);
    expect(can(principal('guest'), 'issue:create')).toBe(false);
  });

  it('lets a contributor create but not delete issues', () => {
    expect(can(principal('contributor'), 'issue:create')).toBe(true);
    expect(can(principal('contributor'), 'issue:delete')).toBe(false);
  });

  it('lets a member delete issues but not manage the organization', () => {
    expect(can(principal('member'), 'issue:delete')).toBe(true);
    expect(can(principal('member'), 'org:manage')).toBe(false);
  });

  it('lets an admin manage the organization and integrations', () => {
    expect(can(principal('admin'), 'org:manage')).toBe(true);
    expect(can(principal('admin'), 'integration:manage')).toBe(true);
  });
});

describe('assertCan', () => {
  it('throws a forbidden domain error when denied', () => {
    let thrown: unknown;
    try {
      assertCan(principal('guest'), 'issue:delete');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('forbidden');
    expect((thrown as DomainError).status).toBe(403);
  });

  it('stays silent when allowed', () => {
    expect(() => {
      assertCan(principal('admin'), 'issue:delete');
    }).not.toThrow();
  });
});

describe('team membership', () => {
  it('accepts a member of the team', () => {
    expect(isInTeam(principal('member', ['team_eng']), 'team_eng')).toBe(true);
  });

  it('rejects a non member', () => {
    expect(isInTeam(principal('member', ['team_eng']), 'team_des')).toBe(false);
    expect(() => {
      assertInTeam(principal('member', ['team_eng']), 'team_des');
    }).toThrow(DomainError);
  });

  it('treats admins as members of every team', () => {
    expect(isInTeam(principal('admin', []), 'team_anything')).toBe(true);
  });
});

describe('role comparison', () => {
  it('ranks roles', () => {
    expect(atLeast('admin', 'member')).toBe(true);
    expect(atLeast('contributor', 'member')).toBe(false);
    expect(atLeast('member', 'member')).toBe(true);
  });

  it('only lets admins assign roles', () => {
    expect(canAssignRole('admin', 'member')).toBe(true);
    expect(canAssignRole('member', 'guest')).toBe(false);
  });
});
