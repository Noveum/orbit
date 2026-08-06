import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { newMentions, resolveHandles, resolveMentions } from '../../src/notifications/mentions.ts';
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

describe('newMentions', () => {
  it('reports only the handles the edit introduced', () => {
    expect(newMentions('cc @ada', 'cc @ada and @grace')).toEqual(['grace']);
  });

  it('reports nothing when the edit repeats the same handles', () => {
    expect(newMentions('cc @ada', '## heading\n\ncc @ada again')).toEqual([]);
  });

  it('treats an empty original as everything being new', () => {
    expect(newMentions('', 'ping @ada')).toEqual(['ada']);
  });
});

describe('resolveMentions', () => {
  it('maps handles to the user ids of workspace members', async () => {
    const teammate = await addMember(workspace, 'member', { name: 'Grace' });
    const resolved = await resolveMentions(
      db,
      workspace.organizationId,
      `Ping @${teammate.user.handle} please`,
      workspace.teamId,
    );
    expect(resolved).toEqual([teammate.user.id]);
  });

  it('ignores a handle that belongs to nobody', async () => {
    expect(
      await resolveMentions(db, workspace.organizationId, 'Ping @nobody-at-all', workspace.teamId),
    ).toEqual([]);
  });

  it('never resolves a member of another workspace', async () => {
    const other = await createWorkspace('Other');
    const outsider = await addMember(other, 'member', { name: 'Outsider' });
    expect(
      await resolveMentions(
        db,
        workspace.organizationId,
        `Ping @${outsider.user.handle}`,
        workspace.teamId,
      ),
    ).toEqual([]);
  });

  it('never resolves a member who cannot see the team the issue lives on', async () => {
    const outsider = await addMember(workspace, 'member', { name: 'Bystander', teamIds: [] });
    expect(
      await resolveMentions(
        db,
        workspace.organizationId,
        `Ping @${outsider.user.handle}`,
        workspace.teamId,
      ),
    ).toEqual([]);
    expect(
      await resolveMentions(db, workspace.organizationId, `Ping @${outsider.user.handle}`, null),
    ).toEqual([outsider.user.id]);
  });

  it('matches a handle whatever case it was typed in', async () => {
    const teammate = await addMember(workspace, 'member', { name: 'Grace' });
    await db
      .update(schema.user)
      .set({ handle: teammate.user.handle.toUpperCase() })
      .where(eq(schema.user.id, teammate.user.id));
    expect(
      await resolveMentions(
        db,
        workspace.organizationId,
        `Ping @${teammate.user.handle.toUpperCase()}`,
        workspace.teamId,
      ),
    ).toEqual([teammate.user.id]);
    expect(
      await resolveHandles(db, workspace.organizationId, ['GrAcE-NoBoDy'], workspace.teamId),
    ).toEqual([]);
  });
});
