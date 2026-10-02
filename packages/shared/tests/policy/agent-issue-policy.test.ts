import { describe, expect, it } from 'bun:test';
import type { OrgRole } from '../../src/constants/index.ts';
import { DomainError } from '../../src/errors/index.ts';
import {
  type AgentIssueAuthority,
  assertHumanIssueWriter,
  authorizeIssueAction,
  type Permission,
  type Principal,
} from '../../src/policy/index.ts';

const RESOURCE = { organizationId: 'org_1', teamId: 'team_eng' };

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'member',
    teamIds: ['team_eng'],
    ...overrides,
  };
}

function authority(overrides: Partial<AgentIssueAuthority> = {}): AgentIssueAuthority {
  return {
    principal: principal(),
    scopes: ['orbit.read', 'orbit.write'],
    organizationId: 'org_1',
    ownerUserId: 'user_1',
    lifecycle: 'active',
    connection: 'connected',
    ...overrides,
  };
}

function caught(run: () => void): DomainError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Expected a DomainError to be thrown.');
}

type IssuePermission = Extract<
  Permission,
  'issue:read' | 'issue:create' | 'issue:update' | 'issue:delete'
>;

const WRITES: readonly IssuePermission[] = ['issue:create', 'issue:update', 'issue:delete'];

describe('authorizeIssueAction', () => {
  it('P0-AUTH-1 allows an action only when grant scope, principal role and resource policy all permit it', () => {
    for (const permission of [
      'issue:read',
      ...WRITES,
    ] as const satisfies readonly IssuePermission[]) {
      expect(() => {
        authorizeIssueAction(authority(), permission, RESOURCE);
      }).not.toThrow();
    }
  });

  it('P0-AUTH-1 rejects a write when the grant carries only the read scope', () => {
    for (const permission of WRITES) {
      const error = caught(() => {
        authorizeIssueAction(
          authority({ scopes: ['orbit.read'] }),
          permission as 'issue:create',
          RESOURCE,
        );
      });
      expect(error.code).toBe('forbidden');
      expect(error.status).toBe(403);
      expect(error.details?.['reason']).toBe('grant_scope_denied');
    }
  });

  it('P0-AUTH-1 rejects a read when the grant omits the read scope even though it allows writes', () => {
    const error = caught(() => {
      authorizeIssueAction(authority({ scopes: ['orbit.write'] }), 'issue:read', RESOURCE);
    });
    expect(error.code).toBe('forbidden');
    expect(error.details?.['reason']).toBe('grant_scope_denied');
  });

  it('P0-AUTH-1 rejects when the principal role lacks the permission even though the grant scope allows it', () => {
    const guest = authority({ principal: principal({ role: 'guest' }) });
    expect(() => {
      authorizeIssueAction(guest, 'issue:read', RESOURCE);
    }).not.toThrow();
    const error = caught(() => {
      authorizeIssueAction(guest, 'issue:create', RESOURCE);
    });
    expect(error.code).toBe('forbidden');
    expect(error.details?.['permission']).toBe('issue:create');
    expect(error.details?.['role']).toBe('guest');
    expect(error.details?.['reason']).toBeUndefined();
  });

  it('P0-AUTH-1 rejects when the principal cannot reach the team even though scope and role allow it', () => {
    const outsider = authority({ principal: principal({ teamIds: ['team_des'] }) });
    const offTeam = caught(() => {
      authorizeIssueAction(outsider, 'issue:read', RESOURCE);
    });
    expect(offTeam.code).toBe('forbidden');
    expect(offTeam.details?.['reason']).toBe('principal_permission_denied');

    const foreignTeam = caught(() => {
      authorizeIssueAction(
        authority({ principal: principal({ role: 'member', teamIds: ['team_eng'] }) }),
        'issue:read',
        { organizationId: 'org_1', teamId: 'team_elsewhere' },
      );
    });
    expect(foreignTeam.details?.['reason']).toBe('principal_permission_denied');

    const crossWorkspaceResource = caught(() => {
      authorizeIssueAction(
        authority({ principal: principal({ role: 'admin', teamIds: [] }) }),
        'issue:read',
        { organizationId: 'org_2', teamId: 'team_eng' },
      );
    });
    expect(crossWorkspaceResource.details?.['reason']).toBe('principal_permission_denied');
  });

  it('P0-AUTH-1 rejects a disabled, deleted or disconnected agent before any other dimension', () => {
    for (const lifecycle of ['disabled', 'deleted'] as const) {
      const error = caught(() => {
        authorizeIssueAction(
          authority({ lifecycle, principal: principal({ role: 'admin' }) }),
          'issue:read',
          RESOURCE,
        );
      });
      expect(error.code).toBe('unauthorized');
      expect(error.status).toBe(401);
      expect(error.details?.['reason']).toBe('agent_inactive');
    }
    const disconnected = caught(() => {
      authorizeIssueAction(
        authority({ connection: 'disconnected', principal: principal({ role: 'admin' }) }),
        'issue:read',
        RESOURCE,
      );
    });
    expect(disconnected.code).toBe('unauthorized');
    expect(disconnected.details?.['reason']).toBe('agent_inactive');
  });

  it('P0-AUTH-1 rejects an agent whose owner or organization does not match the principal', () => {
    const wrongOwner = caught(() => {
      authorizeIssueAction(
        authority({ ownerUserId: 'user_2', principal: principal({ role: 'admin' }) }),
        'issue:read',
        RESOURCE,
      );
    });
    expect(wrongOwner.code).toBe('unauthorized');
    expect(wrongOwner.details?.['reason']).toBe('agent_identity_required');

    const unowned = caught(() => {
      authorizeIssueAction(
        authority({ ownerUserId: null, principal: principal({ role: 'admin' }) }),
        'issue:read',
        RESOURCE,
      );
    });
    expect(unowned.details?.['reason']).toBe('agent_identity_required');

    const wrongWorkspace = caught(() => {
      authorizeIssueAction(
        authority({ organizationId: 'org_2', principal: principal({ role: 'admin' }) }),
        'issue:read',
        RESOURCE,
      );
    });
    expect(wrongWorkspace.details?.['reason']).toBe('agent_identity_required');
  });

  it('P0-AUTH-1 applies a role or team change to the very next request', () => {
    const mutable: { userId: string; organizationId: string; role: OrgRole; teamIds: string[] } = {
      userId: 'user_1',
      organizationId: 'org_1',
      role: 'member',
      teamIds: ['team_eng'],
    };
    const live = () => authority({ principal: mutable });
    expect(() => {
      authorizeIssueAction(live(), 'issue:create', RESOURCE);
    }).not.toThrow();

    mutable.role = 'guest';
    const demoted = caught(() => {
      authorizeIssueAction(live(), 'issue:create', RESOURCE);
    });
    expect(demoted.code).toBe('forbidden');
    expect(demoted.details?.['permission']).toBe('issue:create');

    mutable.role = 'member';
    mutable.teamIds = [];
    const moved = caught(() => {
      authorizeIssueAction(live(), 'issue:read', RESOURCE);
    });
    expect(moved.code).toBe('forbidden');
    expect(moved.details?.['reason']).toBe('principal_permission_denied');
  });
});

describe('assertHumanIssueWriter', () => {
  it('P0-AUTH-1 refuses an agent actor at the shared writer gate and admits a human', () => {
    const error = caught(() => {
      assertHumanIssueWriter('agent');
    });
    expect(error.code).toBe('forbidden');
    expect(error.status).toBe(403);
    expect(() => {
      assertHumanIssueWriter('user');
    }).not.toThrow();
  });
});
