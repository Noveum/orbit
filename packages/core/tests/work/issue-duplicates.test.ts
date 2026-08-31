import { beforeEach, describe, expect, it } from 'bun:test';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { archiveIssue, createIssue, findDuplicateIssues } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Orbit Testing');
});

describe('findDuplicateIssues', () => {
  it('suggests existing issues matching title trigram similarity ordered most similar first', async () => {
    const { issue: original } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Passkey login fails on Safari',
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Safari passkey authentication error',
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Completely unrelated billing invoice export',
    });

    const duplicates = await findDuplicateIssues(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Safari passkey login failure',
    });

    expect(duplicates.length).toBeGreaterThanOrEqual(1);
    expect(duplicates.map((d) => d.id)).toContain(original.id);
    expect(duplicates[0]?.state).toMatchObject({
      name: expect.any(String),
      category: expect.any(String),
    });
  });

  it('hides duplicate suggestions for issues in teams the caller cannot access', async () => {
    const otherTeam = await createTeam(workspace.admin, { name: 'Security', key: 'SEC' });
    await createIssue(workspace.admin, {
      teamId: otherTeam.team.id,
      title: 'Critical zero-day vulnerability in auth',
    });

    const { principal: regularMember } = await addMember(workspace, 'member');

    const duplicates = await findDuplicateIssues(regularMember, {
      teamId: otherTeam.team.id,
      title: 'Critical zero-day vulnerability in auth',
    });

    expect(duplicates).toHaveLength(0);
  });

  it('excludes archived issues from duplicate suggestions', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Fix broken navigation breadcrumb',
    });
    await archiveIssue(workspace.admin, issue.id);

    const duplicates = await findDuplicateIssues(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Fix broken navigation breadcrumb link',
    });

    expect(duplicates.map((d) => d.id)).not.toContain(issue.id);
  });

  it('enforces workspace tenant isolation', async () => {
    const otherWorkspace = await createWorkspace('Other Org');
    const { issue: otherIssue } = await createIssue(otherWorkspace.admin, {
      teamId: otherWorkspace.teamId,
      title: 'Shared standard bug report title',
    });

    const duplicates = await findDuplicateIssues(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Shared standard bug report title',
    });

    expect(duplicates.map((d) => d.id)).not.toContain(otherIssue.id);
  });

  it('returns empty array when title has less than 3 characters', async () => {
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Fix issue',
    });

    const duplicates = await findDuplicateIssues(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Fi',
    });

    expect(duplicates).toEqual([]);
  });
});
