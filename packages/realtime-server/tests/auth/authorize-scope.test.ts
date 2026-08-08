import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import {
  authenticateTicket,
  authorizeScope,
  type ConnectionPrincipal,
  membershipStillValid,
  refreshedPrincipal,
  sessionStillValid,
} from '../../src/auth.ts';
import {
  dropSeededWorkspaces,
  insertSession,
  principalFor,
  type SeededWorkspace,
  seedWorkspace,
} from '../fixture.ts';

let home: SeededWorkspace;
let away: SeededWorkspace;

beforeAll(async () => {
  home = await seedWorkspace('Home');
  away = await seedWorkspace('Away');
});

afterAll(async () => {
  await dropSeededWorkspaces();
});

function reader(overrides: Partial<ConnectionPrincipal> = {}): ConnectionPrincipal {
  return principalFor(home, overrides);
}

function admin(): ConnectionPrincipal {
  return principalFor(home, {
    userId: home.adminUserId,
    name: 'Ada Admin',
    role: 'admin',
    teamIds: [],
  });
}

interface ScopeCase {
  readonly name: string;
  readonly scope: () => string;
  readonly principal: () => ConnectionPrincipal;
  readonly allowed: boolean;
}

const CASES: readonly ScopeCase[] = [
  {
    name: 'org scope for the workspace the connection authenticated into',
    scope: () => `org:${home.organizationId}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'org scope for another workspace',
    scope: () => `org:${away.organizationId}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'team scope for a team the member is on',
    scope: () => `team:${home.teamCore}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'team scope for a team the member is not on',
    scope: () => `team:${home.teamOther}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'team scope for a team in another workspace',
    scope: () => `team:${away.teamCore}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'team scope for an admin who joined no team',
    scope: () => `team:${home.teamOther}`,
    principal: admin,
    allowed: true,
  },
  {
    name: 'user scope for the connected user',
    scope: () => `user:${home.readerUserId}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'user scope for another user',
    scope: () => `user:${home.adminUserId}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'user scope for another user, asked by an admin',
    scope: () => `user:${home.readerUserId}`,
    principal: admin,
    allowed: false,
  },
  {
    name: 'issue scope on a team the member is on',
    scope: () => `issue:${home.issueOnCore}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'issue scope on a team the member is not on',
    scope: () => `issue:${home.issueOnOther}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'issue scope in another workspace',
    scope: () => `issue:${away.issueOnCore}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'issue scope in another workspace, asked by an admin',
    scope: () => `issue:${away.issueOnCore}`,
    principal: admin,
    allowed: false,
  },
  {
    name: 'issue scope that does not exist',
    scope: () => 'issue:iss_missing',
    principal: reader,
    allowed: false,
  },
  {
    name: 'project scope on a project no team owns',
    scope: () => `project:${home.projectWithoutTeams}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'project scope on a project another team owns',
    scope: () => `project:${home.projectOnOther}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'project scope in another workspace',
    scope: () => `project:${away.projectWithoutTeams}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'project scope for a member on no team at all',
    scope: () => `project:${home.projectWithoutTeams}`,
    principal: () => reader({ userId: home.strangerUserId, teamIds: [] }),
    allowed: false,
  },
  {
    name: 'doc scope on a workspace wide doc',
    scope: () => `doc:${home.workspaceDoc}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'doc scope on a private doc with no grant',
    scope: () => `doc:${home.privateDoc}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'doc scope on a private doc granted to the user',
    scope: () => `doc:${home.docGrantedToReader}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'doc scope on a private doc granted to a team the user is on',
    scope: () => `doc:${home.docGrantedToCore}`,
    principal: reader,
    allowed: true,
  },
  {
    name: 'doc scope on a private doc granted to a team the user left',
    scope: () => `doc:${home.docGrantedToOther}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'doc scope on a private doc the principal wrote',
    scope: () => `doc:${home.privateDoc}`,
    principal: () => reader({ userId: home.adminUserId }),
    allowed: true,
  },
  {
    name: 'doc scope on a doc in another workspace',
    scope: () => `doc:${away.workspaceDoc}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'doc scope on a doc that does not exist',
    scope: () => 'doc:doc_missing',
    principal: reader,
    allowed: false,
  },
  {
    name: 'a scope kind nobody publishes',
    scope: () => `cycle:${home.teamCore}`,
    principal: reader,
    allowed: false,
  },
  {
    name: 'a scope with no colon at all',
    scope: () => 'org',
    principal: reader,
    allowed: false,
  },
  {
    name: 'a scope with an empty id',
    scope: () => 'team:',
    principal: reader,
    allowed: false,
  },
];

describe('authorizeScope', () => {
  for (const entry of CASES) {
    it(`${entry.allowed ? 'allows' : 'denies'} ${entry.name}`, async () => {
      expect(await authorizeScope(entry.scope(), entry.principal())).toBe(entry.allowed);
    });
  }
});

describe('authenticateTicket', () => {
  it('builds a principal whose team ids stop at the workspace boundary', async () => {
    const crossTeam = `tm_cross_${home.readerUserId.slice(-8)}`;
    const crossMember = `mem_cross_${home.readerUserId.slice(-8)}`;
    await db
      .insert(schema.teamMember)
      .values({ id: crossTeam, teamId: away.teamCore, userId: home.readerUserId });
    await db.insert(schema.member).values({
      id: crossMember,
      organizationId: away.organizationId,
      userId: home.readerUserId,
      role: 'member',
    });
    const { sessionId } = await insertSession(home.readerUserId, new Date(Date.now() + 60_000));

    const result = await authenticateTicket({
      userId: home.readerUserId,
      organizationId: home.organizationId,
      sessionId,
      exp: Date.now() + 60_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.principal.teamIds]).toEqual([home.teamCore]);
    expect(result.principal.role).toBe('member');
    expect(await authorizeScope(`team:${away.teamCore}`, result.principal)).toBe(false);

    await db.delete(schema.teamMember).where(eq(schema.teamMember.id, crossTeam));
    await db.delete(schema.member).where(eq(schema.member.id, crossMember));
  });

  it('gives an admin every team in the workspace and none outside it', async () => {
    const { sessionId } = await insertSession(home.adminUserId, new Date(Date.now() + 60_000));

    const result = await authenticateTicket({
      userId: home.adminUserId,
      organizationId: home.organizationId,
      sessionId,
      exp: Date.now() + 60_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.principal.teamIds].sort()).toEqual([home.teamCore, home.teamOther].sort());
  });

  it('rejects a ticket whose session already expired', async () => {
    const { sessionId } = await insertSession(home.readerUserId, new Date(Date.now() - 1_000));

    const result = await authenticateTicket({
      userId: home.readerUserId,
      organizationId: home.organizationId,
      sessionId,
      exp: Date.now() + 60_000,
    });

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('rejects a session that belongs to a different user', async () => {
    const { sessionId } = await insertSession(home.adminUserId, new Date(Date.now() + 60_000));

    const result = await authenticateTicket({
      userId: home.readerUserId,
      organizationId: home.organizationId,
      sessionId,
      exp: Date.now() + 60_000,
    });

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('rejects a workspace the user is not a member of', async () => {
    const { sessionId } = await insertSession(home.strangerUserId, new Date(Date.now() + 60_000));

    const result = await authenticateTicket({
      userId: home.strangerUserId,
      organizationId: away.organizationId,
      sessionId,
      exp: Date.now() + 60_000,
    });

    expect(result).toEqual({ ok: false, reason: 'organization_forbidden' });
  });

  it('rejects a new connection while workspace deletion is pending', async () => {
    const { sessionId } = await insertSession(home.readerUserId, new Date(Date.now() + 60_000));
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, home.organizationId));
    try {
      const result = await authenticateTicket({
        userId: home.readerUserId,
        organizationId: home.organizationId,
        sessionId,
        exp: Date.now() + 60_000,
      });
      expect(result).toEqual({ ok: false, reason: 'organization_forbidden' });
    } finally {
      await db
        .update(schema.organization)
        .set({ deletionRequestedAt: null })
        .where(eq(schema.organization.id, home.organizationId));
    }
  });

  it('falls back to guest for a role nobody recognises', async () => {
    await db
      .update(schema.member)
      .set({ role: 'superuser' })
      .where(eq(schema.member.userId, away.strangerUserId));
    const { sessionId } = await insertSession(away.strangerUserId, new Date(Date.now() + 60_000));

    const result = await authenticateTicket({
      userId: away.strangerUserId,
      organizationId: away.organizationId,
      sessionId,
      exp: Date.now() + 60_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.role).toBe('guest');
    expect(await authorizeScope(`team:${away.teamOther}`, result.principal)).toBe(false);

    await db
      .update(schema.member)
      .set({ role: 'member' })
      .where(eq(schema.member.userId, away.strangerUserId));
  });
});

describe('sessionStillValid and membershipStillValid', () => {
  it('reports a live session valid and an expired one invalid', async () => {
    const live = await insertSession(home.readerUserId, new Date(Date.now() + 60_000));
    const dead = await insertSession(home.readerUserId, new Date(Date.now() - 1_000));

    expect(await sessionStillValid(live.sessionId)).toBe(true);
    expect(await sessionStillValid(dead.sessionId)).toBe(false);
    expect(await sessionStillValid('ses_never_existed')).toBe(false);
  });

  it('reports a removed member invalid without touching the rest of the workspace', async () => {
    expect(await membershipStillValid(reader())).toBe(true);
    expect(
      await membershipStillValid(
        reader({ userId: home.strangerUserId, organizationId: away.organizationId }),
      ),
    ).toBe(false);
  });

  it('reports a pending workspace deletion as terminal membership loss', async () => {
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, home.organizationId));
    try {
      expect(await membershipStillValid(reader())).toBe(false);
      expect(await refreshedPrincipal(reader())).toBeNull();
    } finally {
      await db
        .update(schema.organization)
        .set({ deletionRequestedAt: null })
        .where(eq(schema.organization.id, home.organizationId));
    }
  });
});

describe('refreshedPrincipal', () => {
  it('picks up a role change and widens the teams an admin can reach', async () => {
    const before = reader({ userId: home.strangerUserId, teamIds: [] });
    expect(await authorizeScope(`team:${home.teamCore}`, before)).toBe(false);

    await db
      .update(schema.member)
      .set({ role: 'admin' })
      .where(eq(schema.member.userId, home.strangerUserId));
    const after = await refreshedPrincipal(before);

    expect(after?.role).toBe('admin');
    expect([...(after?.teamIds ?? [])].sort()).toEqual([home.teamCore, home.teamOther].sort());

    await db
      .update(schema.member)
      .set({ role: 'member' })
      .where(eq(schema.member.userId, home.strangerUserId));
  });

  it('returns null once the membership is gone', async () => {
    expect(
      await refreshedPrincipal(
        reader({ userId: home.strangerUserId, organizationId: away.organizationId }),
      ),
    ).toBeNull();
  });
});
