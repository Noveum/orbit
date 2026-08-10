import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { STATE_CATEGORIES } from '@orbit/shared/constants';
import { scopes } from '@orbit/shared/events';
import {
  createOrganization,
  getOrganizationBySlug,
  listOrganizationsForUser,
  updateOrganization,
} from '../../src/org/organization-service.ts';
import { createTeam, deriveTeamKey, listTeams } from '../../src/org/team-service.ts';
import {
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('createOrganization', () => {
  it('bootstraps the org, an admin member, a default team, seven states, and labels', async () => {
    const user = await createUser('Nia New');
    const bootstrap = await createOrganization(user.id, { name: 'Comet', slug: 'comet' });

    expect(bootstrap.member.role).toBe('admin');
    expect(bootstrap.team.key).toBe('COMET');
    expect(bootstrap.states).toHaveLength(7);
    expect(bootstrap.states.map((state) => state.category).sort()).toEqual(
      [...STATE_CATEGORIES].sort(),
    );
    expect(bootstrap.labels.length).toBeGreaterThan(0);

    const cycles = await db
      .select()
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, bootstrap.organization.id));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.number).toBe(1);

    expect(bootstrap.actions.map((action) => action.model).sort()).toEqual(['member', 'team']);
    expect(bootstrap.actions[0]?.scopes).toContain(scopes.organization(bootstrap.organization.id));
  });

  it('refuses a duplicate slug', async () => {
    const user = await createUser('Nia New');
    await createOrganization(user.id, { name: 'Comet', slug: 'comet' });
    const other = await createUser('Otto Other');
    await expect(
      createOrganization(other.id, { name: 'Comet Two', slug: 'comet' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('updateOrganization', () => {
  it('updates only the provided fields', async () => {
    const before = await getOrganizationBySlug(
      (await listOrganizationsForUser(workspace.adminUser.id))[0]?.organization.slug ?? '',
    );
    const { organization, actions } = await updateOrganization(workspace.admin, {
      allowedEmailDomains: ['orbit.test'],
    });

    expect(organization.name).toBe(before.name);
    expect(organization.allowedEmailDomains).toEqual(['orbit.test']);
    expect(actions[0]?.model).toBe('organization');
  });

  it('refuses a non admin', async () => {
    const user = await createUser('Mo Member');
    await db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId: workspace.organizationId,
      userId: user.id,
      role: 'member',
    });
    await expect(
      updateOrganization(
        { userId: user.id, organizationId: workspace.organizationId, role: 'member', teamIds: [] },
        { name: 'Nope' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('listOrganizationsForUser', () => {
  it('returns every workspace the member belongs to and no other tenant', async () => {
    const user = await createUser('Nia New');
    const first = await createOrganization(user.id, { name: 'Comet', slug: 'comet' });
    const second = await createOrganization(user.id, { name: 'Nebula', slug: 'nebula' });
    const stranger = await createUser('Otto Other');
    await createOrganization(stranger.id, { name: 'Quasar', slug: 'quasar' });

    const mine = await listOrganizationsForUser(user.id);

    expect(mine.map((row) => row.organization.slug)).toEqual(['comet', 'nebula']);
    expect(mine.map((row) => row.organization.id).sort()).toEqual(
      [first.organization.id, second.organization.id].sort(),
    );
    expect(mine.every((row) => row.role === 'admin')).toBe(true);

    const theirs = await listOrganizationsForUser(stranger.id);
    expect(theirs.map((row) => row.organization.slug)).toEqual(['quasar']);
  });

  it('hides a pending deletion except from an administrator retry listing', async () => {
    const user = await createUser('Nia New');
    const active = await createOrganization(user.id, { name: 'Comet', slug: 'comet' });
    const deleting = await createOrganization(user.id, { name: 'Nebula', slug: 'nebula' });
    const member = await createUser('Mira Member');
    await db.insert(schema.member).values({
      id: 'member_pending_workspace',
      organizationId: deleting.organization.id,
      userId: member.id,
      role: 'member',
    });
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, deleting.organization.id));

    const mine = await listOrganizationsForUser(user.id);
    const retryable = await listOrganizationsForUser(user.id, {
      includeDeletingForAdmins: true,
    });
    const memberRetryable = await listOrganizationsForUser(member.id, {
      includeDeletingForAdmins: true,
    });

    expect(mine.map((row) => row.organization.id)).toEqual([active.organization.id]);
    expect(retryable.map((row) => row.organization.id).sort()).toEqual(
      [active.organization.id, deleting.organization.id].sort(),
    );
    expect(memberRetryable).toEqual([]);
  });
});

describe('teams', () => {
  it('derives a key from the name', () => {
    expect(deriveTeamKey('Nova')).toBe('NOVA');
    expect(deriveTeamKey('Platform Engineering')).toBe('PE');
    expect(deriveTeamKey('a')).toBe('TEAMA');
  });

  it('creates a team with its states and first cycle, and dedupes the key', async () => {
    const created = await createTeam(workspace.admin, { name: 'Design', key: 'NOVA' });
    expect(created.team.key).toBe('NOVA2');
    expect(created.states).toHaveLength(7);
    expect(created.cycle.number).toBe(1);
    expect(created.actions[0]?.scopes).toContain(scopes.team(created.team.id));

    const teams = await listTeams(workspace.admin);
    expect(teams).toHaveLength(2);
  });

  it('refuses team creation for a non admin', async () => {
    await expect(
      createTeam(
        {
          userId: workspace.adminUser.id,
          organizationId: workspace.organizationId,
          role: 'member',
          teamIds: [workspace.teamId],
        },
        { name: 'Design', key: 'DSGN' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('updateOrganization row versioning', () => {
  it('persists the allocated sync id on the row', async () => {
    const [before] = await db
      .select({ syncId: schema.organization.syncId })
      .from(schema.organization)
      .where(eq(schema.organization.id, workspace.organizationId));

    const result = await updateOrganization(workspace.admin, { name: 'Noveum Labs' });

    const [after] = await db
      .select({ syncId: schema.organization.syncId })
      .from(schema.organization)
      .where(eq(schema.organization.id, workspace.organizationId));

    expect(after?.syncId).toBeGreaterThan(before?.syncId ?? 0);
    expect(after?.syncId).toBe(result.actions[0]?.syncId);
  });
});
