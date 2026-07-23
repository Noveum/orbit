import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import { createUser, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  acceptInvite,
  createInvite,
  createInvites,
  listPendingInvites,
  matchAllowedDomain,
  resendInvite,
  revokeInvite,
} from './invite-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('createInvite', () => {
  it('creates a pending invite with a 14 day expiry and a token', async () => {
    const invited = await createUser('Ivy Invitee');
    const { invitation, token, actions } = await createInvite(workspace.admin, {
      email: invited.email,
      teamIds: [workspace.teamId],
    });

    expect(invitation.status).toBe('pending');
    expect(token).toBe(invitation.id);
    const days = (invitation.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect(actions[0]?.scopes).toContain(scopes.organization(workspace.organizationId));
  });

  it('refuses an email that already belongs to a member', async () => {
    await expect(
      createInvite(workspace.admin, { email: workspace.adminUser.email }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('creates invites in bulk', async () => {
    const one = await createUser('One');
    const two = await createUser('Two');
    const { invites, actions } = await createInvites(workspace.admin, {
      invites: [{ email: one.email }, { email: two.email }],
    });
    expect(invites).toHaveLength(2);
    expect(actions).toHaveLength(2);
    expect(await listPendingInvites(workspace.admin)).toHaveLength(2);
  });
});

describe('acceptInvite', () => {
  it('creates the member row and the team memberships', async () => {
    const invited = await createUser('Ivy Invitee');
    const { token } = await createInvite(workspace.admin, {
      email: invited.email,
      role: 'contributor',
      teamIds: [workspace.teamId],
    });

    const accepted = await acceptInvite(token, invited.id);
    expect(accepted.alreadyAccepted).toBe(false);
    expect(accepted.member.role).toBe('contributor');
    expect(accepted.teamIds).toEqual([workspace.teamId]);
    expect(accepted.actions[0]?.scopes).toEqual(
      expect.arrayContaining([scopes.user(invited.id), scopes.team(workspace.teamId)]),
    );

    const teams = await db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.userId, invited.id));
    expect(teams).toHaveLength(1);

    const [invitation] = await db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.id, token));
    expect(invitation?.status).toBe('accepted');
  });

  it('is idempotent when the token is used twice', async () => {
    const invited = await createUser('Ivy Invitee');
    const { token } = await createInvite(workspace.admin, {
      email: invited.email,
      teamIds: [workspace.teamId],
    });

    const first = await acceptInvite(token, invited.id);
    const second = await acceptInvite(token, invited.id);

    expect(second.alreadyAccepted).toBe(true);
    expect(second.member.id).toBe(first.member.id);
    expect(second.actions).toEqual([]);

    const members = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, invited.id));
    expect(members).toHaveLength(1);
  });

  it('refuses a used token for a different account', async () => {
    const invited = await createUser('Ivy Invitee');
    const other = await createUser('Other Person');
    const { token } = await createInvite(workspace.admin, { email: invited.email });
    await acceptInvite(token, invited.id);

    await expect(acceptInvite(token, other.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses an invite sent to a different email address', async () => {
    const invited = await createUser('Ivy Invitee');
    const other = await createUser('Other Person');
    const { token } = await createInvite(workspace.admin, { email: invited.email });
    await expect(acceptInvite(token, other.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses an expired invite', async () => {
    const invited = await createUser('Ivy Invitee');
    const { token } = await createInvite(workspace.admin, { email: invited.email });
    await db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitation.id, token));

    await expect(acceptInvite(token, invited.id)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('revokeInvite and resendInvite', () => {
  it('revokes a pending invite once', async () => {
    const invited = await createUser('Ivy Invitee');
    const { token } = await createInvite(workspace.admin, { email: invited.email });

    const revoked = await revokeInvite(workspace.admin, token);
    expect(revoked.invitation.status).toBe('revoked');
    await expect(revokeInvite(workspace.admin, token)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('extends the expiry when resent', async () => {
    const invited = await createUser('Ivy Invitee');
    const { token } = await createInvite(workspace.admin, { email: invited.email });
    await db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitation.id, token));

    const resent = await resendInvite(workspace.admin, token);
    expect(resent.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(resent.token).toBe(token);
  });
});

describe('matchAllowedDomain', () => {
  it('matches a configured domain and ignores others', () => {
    const organization = { allowedEmailDomains: ['orbit.test', '@Example.com'] };
    expect(matchAllowedDomain(organization, 'a@orbit.test')).toBe('orbit.test');
    expect(matchAllowedDomain(organization, 'b@example.com')).toBe('example.com');
    expect(matchAllowedDomain(organization, 'c@nope.dev')).toBeNull();
    expect(matchAllowedDomain(organization, 'not-an-email')).toBeNull();
  });
});
