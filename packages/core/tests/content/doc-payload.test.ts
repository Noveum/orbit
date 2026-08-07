import { beforeEach, describe, expect, it } from 'bun:test';
import { createDoc, getDoc, listDocs, moveDoc, updateDoc } from '../../src/content/doc-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('doc payloads', () => {
  it('never ships the search vector to a caller', async () => {
    const { doc: created, actions } = await createDoc(workspace.admin, {
      title: 'Runbook',
      content: 'Page the on call engineer.',
    });

    const [listed] = await listDocs(workspace.admin, {});
    const detail = await getDoc(workspace.admin, created.id);
    const { doc: updated } = await updateDoc(workspace.admin, created.id, { title: 'Renamed' });
    const { doc: movedRow } = await moveDoc(workspace.admin, created.id, {
      beforeId: null,
      afterId: null,
    });

    for (const payload of [created, listed, detail.doc, updated, movedRow]) {
      expect(payload).not.toHaveProperty('searchVector');
    }
    expect(actions[0]?.data).not.toHaveProperty('searchVector');
  });
});
