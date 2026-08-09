import { beforeAll, describe, expect, it } from 'bun:test';
import {
  addMember,
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { resolveMembership } from '../../../src/lib/auth/principal.ts';

let nova: Workspace;
let orion: Workspace;
let novaTeamTwo: string;
let dualUserId: string;
let strangerId: string;
let oddRoleUserId: string;

beforeAll(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');

  const [extraTeam] = await db
    .insert(schema.team)
    .values({
      id: 'team_nova_two',
      organizationId: nova.organizationId,
      name: 'Nova Two',
      key: 'NT',
    })
    .returning({ id: schema.team.id });
  novaTeamTwo = extraTeam?.id ?? '';

  const dual = await addMember(nova, 'member', {
    name: 'Dual Citizen',
    teamIds: [nova.teamId, novaTeamTwo],
  });
  dualUserId = dual.user.id;
  await db.insert(schema.member).values({
    id: 'member_dual_orion',
    organizationId: orion.organizationId,
    userId: dualUserId,
    role: 'admin',
  });
  await db
    .insert(schema.teamMember)
    .values({ id: 'tm_dual_orion', teamId: orion.teamId, userId: dualUserId });

  const stranger = await createUser('No Workspace');
  strangerId = stranger.id;

  const odd = await addMember(nova, 'member', { name: 'Odd Role', teamIds: [nova.teamId] });
  oddRoleUserId = odd.user.id;
  await db
    .update(schema.member)
    .set({ role: 'superuser' })
    .where(eq(schema.member.userId, oddRoleUserId));
});

describe('resolveMembership', () => {
  it('keeps team ids inside the active workspace when the user belongs to two', async () => {
    const inNova = await resolveMembership(dualUserId, nova.organizationId);

    expect(inNova?.principal.organizationId).toBe(nova.organizationId);
    expect([...(inNova?.principal.teamIds ?? [])].sort()).toEqual(
      [nova.teamId, novaTeamTwo].sort(),
    );
    expect(inNova?.principal.teamIds).not.toContain(orion.teamId);
  });

  it('swaps the whole reach when the same user switches workspace', async () => {
    const inOrion = await resolveMembership(dualUserId, orion.organizationId);

    expect(inOrion?.principal.organizationId).toBe(orion.organizationId);
    expect([...(inOrion?.principal.teamIds ?? [])]).toEqual([orion.teamId]);
    expect(inOrion?.principal.role).toBe('admin');
    expect(inOrion?.organizationName).toBe('Orion');
  });

  it('falls back to a membership of its own when the active workspace is unset', async () => {
    const resolved = await resolveMembership(nova.adminUser.id, null);

    expect(resolved?.principal.organizationId).toBe(nova.organizationId);
    expect(resolved?.principal.role).toBe('admin');
  });

  it('ignores an active workspace the user is not a member of', async () => {
    const resolved = await resolveMembership(nova.adminUser.id, orion.organizationId);

    expect(resolved?.principal.organizationId).toBe(nova.organizationId);
  });

  it('reads a role it does not recognise as guest rather than as an admin', async () => {
    const resolved = await resolveMembership(oddRoleUserId, nova.organizationId);

    expect(resolved?.principal.role).toBe('guest');
  });

  it('returns null for a user who is in no workspace at all', async () => {
    expect(await resolveMembership(strangerId, null)).toBeNull();
    expect(await resolveMembership(strangerId, nova.organizationId)).toBeNull();
  });

  it('carries the member row and workspace naming the shell renders', async () => {
    const resolved = await resolveMembership(nova.adminUser.id, nova.organizationId);

    expect(resolved?.memberId.length ?? 0).toBeGreaterThan(0);
    expect(resolved?.organizationName).toBe('Nova');
    expect(resolved?.organizationSlug.startsWith('nova-')).toBe(true);
    expect(resolved?.deletionRequestedAt).toBeNull();
  });

  it('exposes a pending deletion so the app can limit the workspace to retry', async () => {
    const requestedAt = new Date('2026-08-08T13:00:00.000Z');
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: requestedAt })
      .where(eq(schema.organization.id, nova.organizationId));
    try {
      const resolved = await resolveMembership(nova.adminUser.id, nova.organizationId);
      expect(resolved?.deletionRequestedAt).toEqual(requestedAt);
    } finally {
      await db
        .update(schema.organization)
        .set({ deletionRequestedAt: null })
        .where(eq(schema.organization.id, nova.organizationId));
    }
  });
});
