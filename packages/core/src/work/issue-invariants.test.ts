import { beforeEach, describe, expect, it } from 'bun:test';
import { ISSUE_RELATION_TYPES } from '@orbit/shared/constants';
import { createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  createIssue,
  INVERSE_RELATION,
  type IssueRow,
  listRelations,
  PARENT_CHAIN_LIMIT,
  removeRelation,
  setRelation,
  updateIssue,
} from './issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newIssue(title: string, parentId: string | null = null): Promise<IssueRow> {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title,
    parentId,
  });
  return issue;
}

describe('parent chain invariant', () => {
  it('refuses an issue that is its own parent', async () => {
    const issue = await newIssue('Self');
    await expect(
      updateIssue(workspace.admin, issue.id, { parentId: issue.id }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a two step cycle', async () => {
    const parent = await newIssue('Parent');
    const child = await newIssue('Child');
    await updateIssue(workspace.admin, child.id, { parentId: parent.id });

    await expect(
      updateIssue(workspace.admin, parent.id, { parentId: child.id }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a cycle further up the chain', async () => {
    const top = await newIssue('Top');
    const middle = await newIssue('Middle');
    const bottom = await newIssue('Bottom');
    await updateIssue(workspace.admin, middle.id, { parentId: top.id });
    await updateIssue(workspace.admin, bottom.id, { parentId: middle.id });

    await expect(
      updateIssue(workspace.admin, top.id, { parentId: bottom.id }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('accepts a parent that does not close a loop', async () => {
    const parent = await newIssue('Keeper');
    const child = await newIssue('Kept');
    const { issue } = await updateIssue(workspace.admin, child.id, { parentId: parent.id });
    expect(issue.parentId).toBe(parent.id);
  });

  it('refuses a parent that does not exist', async () => {
    await expect(newIssue('Orphan', '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('refuses a parent chain deeper than the bound', async () => {
    let parentId: string | null = null;
    for (let depth = 0; depth <= PARENT_CHAIN_LIMIT; depth += 1) {
      const issue: IssueRow = await newIssue(`Level ${depth}`, parentId);
      parentId = issue.id;
    }
    const deepest = parentId;
    if (deepest === null) throw new Error('missing chain');
    await expect(newIssue('One too deep', deepest)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('relation symmetry invariant', () => {
  it('pairs every relation type with an inverse that maps back', () => {
    for (const type of ISSUE_RELATION_TYPES) {
      const inverse = INVERSE_RELATION[type];
      expect(ISSUE_RELATION_TYPES).toContain(inverse);
      expect(INVERSE_RELATION[inverse]).toBe(type);
    }
  });

  it('writes blocks and blocked_by as a matching pair', async () => {
    const blocker = await newIssue('Blocker');
    const blocked = await newIssue('Blocked');
    await setRelation(workspace.admin, blocker.id, {
      relatedIssueId: blocked.id,
      type: 'blocks',
    });

    expect((await listRelations(workspace.admin, blocker.id)).map((row) => row.type)).toEqual([
      'blocks',
    ]);
    expect((await listRelations(workspace.admin, blocked.id)).map((row) => row.type)).toEqual([
      'blocked_by',
    ]);
  });

  it('leaves exactly one canonical direction for a duplicate', async () => {
    const original = await newIssue('Original');
    const copy = await newIssue('Copy');
    await setRelation(workspace.admin, copy.id, {
      relatedIssueId: original.id,
      type: 'duplicate_of',
    });

    const fromCopy = await listRelations(workspace.admin, copy.id);
    const fromOriginal = await listRelations(workspace.admin, original.id);
    expect(fromCopy.map((row) => row.type)).toEqual(['duplicate_of']);
    expect(fromOriginal.map((row) => row.type)).toEqual(['duplicated_by']);
  });

  it('removes both directions of a duplicate', async () => {
    const original = await newIssue('Original');
    const copy = await newIssue('Copy');
    await setRelation(workspace.admin, copy.id, {
      relatedIssueId: original.id,
      type: 'duplicate_of',
    });
    await removeRelation(workspace.admin, copy.id, {
      relatedIssueId: original.id,
      type: 'duplicate_of',
    });

    expect(await listRelations(workspace.admin, copy.id)).toHaveLength(0);
    expect(await listRelations(workspace.admin, original.id)).toHaveLength(0);
  });
});
