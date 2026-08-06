import { beforeEach, describe, expect, it } from 'bun:test';
import {
  createInvite,
  createInvites,
  resendInvite,
  revokeInvite,
} from '../../src/org/invite-service.ts';
import { catchUp } from '../../src/realtime/backfill.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function wire(actions: readonly { data: Record<string, unknown>; modelId: string }[]): string {
  return JSON.stringify(actions);
}

describe('the invite token never rides the realtime stream', () => {
  it('keeps the accept token out of the action that creates the invite', async () => {
    const created = await createInvite(workspace.admin, {
      email: 'newcomer@orbit.test',
      role: 'member',
      teamIds: [],
    });

    expect(created.token.length).toBeGreaterThan(32);
    expect(wire(created.actions)).not.toContain(created.token);
  });

  it('keeps the invitee address out of it too', async () => {
    const created = await createInvite(workspace.admin, {
      email: 'newcomer@orbit.test',
      role: 'member',
      teamIds: [],
    });

    expect(wire(created.actions)).not.toContain('newcomer@orbit.test');
  });

  it('holds for a bulk invite, a resend and a revoke', async () => {
    const bulk = await createInvites(workspace.admin, {
      invites: [
        { email: 'one@orbit.test', role: 'member', teamIds: [] },
        { email: 'two@orbit.test', role: 'admin', teamIds: [] },
      ],
    });
    for (const invite of bulk.invites) {
      expect(wire(bulk.actions)).not.toContain(invite.token);
    }

    const first = bulk.invites[0];
    if (first === undefined) throw new Error('expected an invite');

    const resent = await resendInvite(workspace.admin, first.invitation.id);
    expect(wire(resent.actions)).not.toContain(first.token);

    const revoked = await revokeInvite(workspace.admin, first.invitation.id);
    expect(wire(revoked.actions)).not.toContain(first.token);
  });

  it('keeps it out of the catch up a plain member replays', async () => {
    const created = await createInvite(workspace.admin, {
      email: 'newcomer@orbit.test',
      role: 'member',
      teamIds: [],
    });
    const member = await addMember(workspace, 'member', { name: 'Plain' });

    const page = await catchUp(member.principal, 0);

    expect(JSON.stringify(page)).not.toContain(created.token);
    expect(JSON.stringify(page)).not.toContain('newcomer@orbit.test');
  });

  it('tells a guest nothing about the invite at all', async () => {
    await createInvite(workspace.admin, {
      email: 'newcomer@orbit.test',
      role: 'member',
      teamIds: [],
    });
    const guest = await addMember(workspace, 'guest', { name: 'Guest' });

    const page = await catchUp(guest.principal, 0);
    const invitations = JSON.stringify(page).match(/"model":"invitation"/g) ?? [];

    expect(invitations).toHaveLength(0);
  });

  it('still identifies the same invite the same way every time', async () => {
    const created = await createInvite(workspace.admin, {
      email: 'newcomer@orbit.test',
      role: 'member',
      teamIds: [],
    });
    const revoked = await revokeInvite(workspace.admin, created.invitation.id);

    expect(revoked.actions[0]?.modelId).toBe(created.actions[0]?.modelId ?? '');
    expect(created.actions[0]?.modelId).not.toBe(created.token);
  });
});
