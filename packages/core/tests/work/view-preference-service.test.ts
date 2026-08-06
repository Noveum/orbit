import { beforeEach, describe, expect, it } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { listViewPreferences, saveViewPreference } from '../../src/work/view-preference-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('remembering how someone likes to see a page', () => {
  it('has nothing to say before anyone has chosen', async () => {
    expect(await listViewPreferences(workspace.admin)).toEqual([]);
  });

  it('keeps the choice, and hands it back on the next visit', async () => {
    await saveViewPreference(workspace.admin, {
      page: 'my_issues',
      scope: '',
      layout: 'board',
      display: { groupBy: 'assignee' },
    });

    const [saved] = await listViewPreferences(workspace.admin);
    expect(saved?.page).toBe('my_issues');
    expect(saved?.layout).toBe('board');
    expect(saved?.display).toEqual({ groupBy: 'assignee' });
  });

  it('replaces the earlier choice for the same page rather than piling up rows', async () => {
    await saveViewPreference(workspace.admin, { page: 'my_issues', scope: '', layout: 'board' });
    await saveViewPreference(workspace.admin, { page: 'my_issues', scope: '', layout: 'list' });

    const all = await listViewPreferences(workspace.admin);
    expect(all).toHaveLength(1);
    expect(all[0]?.layout).toBe('list');
  });

  it('keeps one page separate from another, and one scope from another', async () => {
    await saveViewPreference(workspace.admin, { page: 'my_issues', scope: '', layout: 'board' });
    await saveViewPreference(workspace.admin, { page: 'team', scope: 'eng', layout: 'list' });
    await saveViewPreference(workspace.admin, { page: 'team', scope: 'design', layout: 'board' });

    const all = await listViewPreferences(workspace.admin);
    expect(all).toHaveLength(3);
  });

  it('refuses a layout the product does not have', async () => {
    await expect(
      saveViewPreference(workspace.admin, { page: 'my_issues', scope: '', layout: 'gantt' }),
    ).rejects.toThrow();
  });

  it('keeps one person choices away from another', async () => {
    await saveViewPreference(workspace.admin, { page: 'my_issues', scope: '', layout: 'board' });
    const { principal } = await addMember(workspace, 'member');
    expect(await listViewPreferences(principal)).toEqual([]);
  });
});
