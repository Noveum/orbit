import { beforeEach, describe, expect, it } from 'bun:test';
import { db } from '@orbit/db';
import { listActivity } from '../../src/activity/activity-service.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import {
  archiveIssue,
  createIssue,
  findDuplicateIssues,
  listRelatedIssues,
  listSubscribers,
  markAsDuplicate,
  subscribe,
} from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
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
    const otherWorkspace = await createWorkspace('Vega');
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

describe('markAsDuplicate', () => {
  it('marks issue as duplicate, updates state, repoints subscribers and records activities', async () => {
    const { issue: survivor } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Original Bug Report',
    });

    const { issue: duplicate } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Duplicate Bug Report',
    });

    const member = await addMember(workspace, 'member');
    await subscribe(member.principal, duplicate.id);

    const result = await markAsDuplicate(workspace.admin, duplicate.id, {
      survivorIssueId: survivor.id,
    });

    expect(result.issue.id).toBe(duplicate.id);
    expect(result.issue.stateId).not.toBe(duplicate.stateId);
    expect(result.issue.canceledAt).not.toBeNull();

    const dupRelations = await listRelatedIssues(workspace.admin, duplicate.id);
    expect(dupRelations).toHaveLength(1);
    expect(dupRelations[0]?.type).toBe('duplicate_of');
    expect(dupRelations[0]?.issue.id).toBe(survivor.id);

    const survRelations = await listRelatedIssues(workspace.admin, survivor.id);
    expect(survRelations).toHaveLength(1);
    expect(survRelations[0]?.type).toBe('duplicated_by');
    expect(survRelations[0]?.issue.id).toBe(duplicate.id);

    const survivorSubs = await listSubscribers(workspace.admin, survivor.id);
    const survivorSubIds = survivorSubs.map((s) => s.userId);
    expect(survivorSubIds).toContain(workspace.admin.userId);
    expect(survivorSubIds).toContain(member.user.id);

    const dupSubs = await listSubscribers(workspace.admin, duplicate.id);
    expect(dupSubs).toHaveLength(0);

    const survivorActivities = await listActivity(db, workspace.admin, survivor.id);
    const linkActivity = survivorActivities.find((a) => a.field === 'relation');
    expect(linkActivity).toBeDefined();
    expect(linkActivity?.toValue).toBe(`duplicated_by ${duplicate.identifier}`);
  });

  it('rejects marking an issue as duplicate of itself', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Self Duplicate Test',
    });

    let error: unknown;
    try {
      await markAsDuplicate(workspace.admin, issue.id, { survivorIssueId: issue.id });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });

  it('replaces previous survivor relation when marked as duplicate of a new survivor', async () => {
    const { issue: duplicate } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Duplicate Issue',
    });
    const { issue: survivorA } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Survivor Issue A',
    });
    const { issue: survivorB } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Survivor Issue B',
    });

    await markAsDuplicate(workspace.admin, duplicate.id, { survivorIssueId: survivorA.id });
    await markAsDuplicate(workspace.admin, duplicate.id, { survivorIssueId: survivorB.id });

    const dupRelations = await listRelatedIssues(workspace.admin, duplicate.id);
    expect(dupRelations).toHaveLength(1);
    expect(dupRelations[0]?.type).toBe('duplicate_of');
    expect(dupRelations[0]?.issue.id).toBe(survivorB.id);

    const survivorARelations = await listRelatedIssues(workspace.admin, survivorA.id);
    expect(survivorARelations).toHaveLength(0);

    const survivorBRelations = await listRelatedIssues(workspace.admin, survivorB.id);
    expect(survivorBRelations).toHaveLength(1);
    expect(survivorBRelations[0]?.type).toBe('duplicated_by');
    expect(survivorBRelations[0]?.issue.id).toBe(duplicate.id);
  });

  it('rejects creating duplicate cycles (A to B then B to A)', async () => {
    const { issue: issueA } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Issue A',
    });
    const { issue: issueB } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Issue B',
    });

    await markAsDuplicate(workspace.admin, issueA.id, { survivorIssueId: issueB.id });

    let error: unknown;
    try {
      await markAsDuplicate(workspace.admin, issueB.id, { survivorIssueId: issueA.id });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });

  it('rejects marking an archived issue as a survivor', async () => {
    const { issue: duplicate } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Duplicate Issue',
    });
    const { issue: survivor } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Survivor Issue',
    });
    await archiveIssue(workspace.admin, survivor.id);

    let error: unknown;
    try {
      await markAsDuplicate(workspace.admin, duplicate.id, { survivorIssueId: survivor.id });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });

  it('rejects marking an issue as duplicate of an issue that is already a duplicate', async () => {
    const { issue: issueA } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Issue A',
    });
    const { issue: issueB } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Issue B',
    });
    const { issue: issueC } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Issue C',
    });

    await markAsDuplicate(workspace.admin, issueB.id, { survivorIssueId: issueC.id });

    let error: unknown;
    try {
      await markAsDuplicate(workspace.admin, issueA.id, { survivorIssueId: issueB.id });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });
});
