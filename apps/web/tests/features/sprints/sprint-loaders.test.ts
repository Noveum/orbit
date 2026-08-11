import { beforeEach, describe, expect, it } from 'bun:test';
import { createIssue } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import {
  getActiveCycleView,
  getActiveSprintChrome,
  hasSprintAnalytics,
} from '../../../src/features/sprints/data.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('what the sprint page loads for each tab', () => {
  it('leaves the burn up and the assignee tally out of the chrome the board needs', async () => {
    const chrome = await getActiveSprintChrome(workspace.admin);
    if (chrome === null) throw new Error('the workspace opens with a sprint');

    expect(hasSprintAnalytics(chrome)).toBe(false);
    expect(Object.keys(chrome)).not.toContain('progress');
    expect(Object.keys(chrome)).not.toContain('groups');
    expect(Object.keys(chrome)).not.toContain('assignees');
  });

  it('still carries what the header renders', async () => {
    const chrome = await getActiveSprintChrome(workspace.admin);

    expect(chrome?.id.length).toBeGreaterThan(0);
    expect(chrome?.name.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(chrome?.startsAt ?? ''))).toBe(true);
    expect(Number.isFinite(Date.parse(chrome?.endsAt ?? ''))).toBe(true);
    expect(chrome?.completedAt).toBeNull();
  });

  it('loads the burn up and the tally only when insights asks for them', async () => {
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Counted' });
    const full = await getActiveCycleView(workspace.admin);
    if (full === null) throw new Error('the workspace opens with a sprint');

    expect(hasSprintAnalytics(full)).toBe(true);
    expect(full.progress.cycleId).toBe(full.id);
    expect(Array.isArray(full.groups)).toBe(true);
    expect(Array.isArray(full.assignees)).toBe(true);
  });

  it('agrees with itself about which sprint it is describing', async () => {
    const [chrome, full] = await Promise.all([
      getActiveSprintChrome(workspace.admin),
      getActiveCycleView(workspace.admin),
    ]);

    expect(chrome?.id).toBe(full?.id ?? '');
    expect(chrome?.name).toBe(full?.name ?? '');
    expect(chrome?.number).toBe(full?.number ?? -1);
    expect(chrome?.startsAt).toBe(full?.startsAt ?? '');
  });
});
