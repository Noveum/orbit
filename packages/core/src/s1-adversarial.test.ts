import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { newId } from './internal.ts';
import {
  acceptInvite,
  createInvite,
  createInvites,
  resendInvite,
  revokeInvite,
} from './org/invite-service.ts';
import { removeMember } from './org/member-service.ts';
import { createTeam, removeTeamMember } from './org/team-service.ts';
import {
  addMember,
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from './test-support.ts';
import { createIssue, getIssue, listIssues } from './work/issue-service.ts';

let nova: Workspace;

beforeEach(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
});

async function memberIdFor(userId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);
  if (row === undefined) throw new Error('missing member row');
  return row.id;
}

async function teamMemberCount(teamId: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.teamMember)
    .where(and(eq(schema.teamMember.teamId, teamId), eq(schema.teamMember.userId, userId)));
  return rows.length;
}

async function siblingTeamId(): Promise<string> {
  const created = await createTeam(nova.admin, { name: 'Design', key: 'DSGN' });
  return created.team.id;
}

describe('D-01 a foreign team id cannot reach across a workspace boundary', () => {
  it('refuses to delete a membership in another workspace and leaves it intact', async () => {
    const vega = await createWorkspace('Vega');
    const victim = await addMember(vega, 'member');
    expect(await teamMemberCount(vega.teamId, victim.user.id)).toBe(1);

    await expect(removeTeamMember(nova.admin, vega.teamId, victim.user.id)).rejects.toMatchObject({
      code: 'not_found',
    });

    expect(await teamMemberCount(vega.teamId, victim.user.id)).toBe(1);
  });
});

describe('D-02 a team id is not an org boundary', () => {
  it('refuses issue creation into a sibling team the actor is not on', async () => {
    const engineer = await addMember(nova, 'contributor', { teamIds: [nova.teamId] });
    const team = await siblingTeamId();

    await expect(
      createIssue(engineer.principal, { teamId: team, title: 'smuggled' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const rows = await db.select().from(schema.issue).where(eq(schema.issue.teamId, team));
    expect(rows).toHaveLength(0);
  });
});

describe('D-03 role escalation is blocked on every invite path', () => {
  it('refuses a member inviting an admin through the bulk endpoint', async () => {
    const member = await addMember(nova, 'member');
    const invited = await createUser('Ivy Invitee');

    await expect(
      createInvites(member.principal, { invites: [{ email: invited.email, role: 'admin' }] }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const invites = await db.select().from(schema.invitation);
    expect(invites).toHaveLength(0);
  });

  it('refuses an admin invite when the inviter was demoted before acceptance', async () => {
    const inviter = await addMember(nova, 'member');
    const invited = await createUser('Ivy Invitee');
    const { token } = await createInvite(nova.admin, { email: invited.email, role: 'admin' });
    await db
      .update(schema.invitation)
      .set({ inviterId: inviter.user.id })
      .where(eq(schema.invitation.id, token));

    await expect(acceptInvite(token, invited.id)).rejects.toMatchObject({ code: 'forbidden' });

    const members = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, invited.id));
    expect(members).toHaveLength(0);
  });
});

describe('D-04 a revoked invite cannot be resurrected', () => {
  it('refuses to resend a revoked invite and keeps its status revoked', async () => {
    const invited = await createUser('Ivy Invitee');
    const { token } = await createInvite(nova.admin, { email: invited.email, role: 'member' });
    await revokeInvite(nova.admin, token);

    await expect(resendInvite(nova.admin, token)).rejects.toMatchObject({ code: 'not_found' });

    const [row] = await db.select().from(schema.invitation).where(eq(schema.invitation.id, token));
    expect(row?.status).toBe('revoked');
  });
});

describe('D-05 removing a member destroys their sessions', () => {
  it('deletes the removed user session and spares everyone else', async () => {
    const leaver = await addMember(nova, 'member');
    const stayer = await addMember(nova, 'member');
    await db.insert(schema.session).values([
      {
        id: newId(),
        token: newId(),
        userId: leaver.user.id,
        activeOrganizationId: nova.organizationId,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      {
        id: newId(),
        token: newId(),
        userId: stayer.user.id,
        activeOrganizationId: nova.organizationId,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ]);

    await removeMember(nova.admin, await memberIdFor(leaver.user.id));

    const leaverSessions = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, leaver.user.id));
    const stayerSessions = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, stayer.user.id));
    expect(leaverSessions).toHaveLength(0);
    expect(stayerSessions).toHaveLength(1);
  });
});

describe('D-17 reads are confined to the teams a non-admin belongs to', () => {
  it('hides an issue on a team the guest is not on and empties a foreign team page', async () => {
    const team = await siblingTeamId();
    const { issue } = await createIssue(nova.admin, { teamId: team, title: 'design secret' });
    const guest = await addMember(nova, 'guest', { teamIds: [nova.teamId] });

    await expect(getIssue(guest.principal, issue.id)).rejects.toMatchObject({ code: 'not_found' });

    const page = await listIssues(guest.principal, { teamId: team });
    expect(page.issues).toHaveLength(0);
  });
});

describe('D-54 the email domain allowlist is enforced on invite creation', () => {
  const previous = process.env['ALLOWED_EMAIL_DOMAINS'];

  afterEach(() => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = previous ?? '';
  });

  it('rejects an out of domain invite and names the offending domain', async () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'magicapi.com, noveum.ai';

    await expect(
      createInvites(nova.admin, {
        invites: [{ email: 'stranger@gmail.com', role: 'member' }],
      }),
    ).rejects.toMatchObject({ code: 'forbidden', details: { domain: 'gmail.com' } });

    const invites = await db.select().from(schema.invitation);
    expect(invites).toHaveLength(0);
  });
});
