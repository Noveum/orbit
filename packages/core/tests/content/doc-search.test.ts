import { beforeEach, describe, expect, it } from 'bun:test';
import { createDoc, listDocs, setDocAccess } from '../../src/content/doc-service.ts';
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

const FILLER = 'Background prose that says nothing in particular. '.repeat(12);

describe('listDocs search ranking', () => {
  it('puts a title hit above a body hit even when the body hit was edited later', async () => {
    await createDoc(workspace.admin, { title: 'Presence protocol', content: 'Nothing to see.' });
    await createDoc(workspace.admin, {
      title: 'Deploy runbook',
      content: 'Step four checks presence before the cutover.',
    });

    const found = await listDocs(workspace.admin, { query: 'presence' });

    expect(found.map((doc) => doc.title)).toEqual(['Presence protocol', 'Deploy runbook']);
    expect(found[0]?.titleMatch).toBe(true);
    expect(found[1]?.titleMatch).toBe(false);
  });

  it('orders two title hits by how recently they changed', async () => {
    const older = await createDoc(workspace.admin, { title: 'Presence one', content: 'a' });
    const newer = await createDoc(workspace.admin, { title: 'Presence two', content: 'b' });

    const found = await listDocs(workspace.admin, { query: 'presence' });

    expect(found.map((doc) => doc.id)).toEqual([newer.doc.id, older.doc.id]);
  });

  it('returns the passage around a body match, not the head of the doc', async () => {
    await createDoc(workspace.admin, {
      title: 'Deploy runbook',
      content: `${FILLER}The cutover waits on a quorum handshake before traffic moves.`,
    });

    const [found] = await listDocs(workspace.admin, { query: 'quorum handshake' });

    expect(found?.snippet).toContain('quorum handshake');
    expect(found?.snippet.startsWith('…')).toBe(true);
    expect(found?.excerpt.includes('quorum handshake')).toBe(false);
  });

  it('starts the passage at the top of the doc when the match is near the top', async () => {
    await createDoc(workspace.admin, {
      title: 'Deploy runbook',
      content: `A quorum handshake gates the cutover. ${FILLER}`,
    });

    const [found] = await listDocs(workspace.admin, { query: 'quorum' });

    expect(found?.snippet.startsWith('A quorum handshake')).toBe(true);
  });

  it('leaves the passage empty when only the title matched', async () => {
    await createDoc(workspace.admin, { title: 'Quorum notes', content: 'Nothing relevant here.' });

    const [found] = await listDocs(workspace.admin, { query: 'quorum' });

    expect(found?.titleMatch).toBe(true);
    expect(found?.snippet).toBe('');
  });

  it('reads a percent sign in the query as a character, not a wildcard', async () => {
    await createDoc(workspace.admin, { title: 'Budget', content: 'We are at 40% of the cap.' });
    await createDoc(workspace.admin, { title: 'Traffic', content: 'We saw 409 responses spike.' });

    const found = await listDocs(workspace.admin, { query: '40%' });

    expect(found.map((doc) => doc.title)).toEqual(['Budget']);
    expect(found[0]?.snippet).toContain('40%');
  });

  it('never carries a restricted doc, title or passage, to someone without a grant', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { doc } = await createDoc(workspace.admin, {
      title: 'Quorum severance terms',
      content: 'A quorum of two signs off.',
      visibility: 'private',
    });

    expect(await listDocs(member.principal, { query: 'quorum' })).toEqual([]);

    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: member.principal.userId, level: 'read' }],
    });

    const found = await listDocs(member.principal, { query: 'quorum' });
    expect(found.map((entry) => entry.title)).toEqual(['Quorum severance terms']);
  });

  it('honours a limit so a palette can ask for a handful', async () => {
    for (const index of [1, 2, 3, 4, 5]) {
      await createDoc(workspace.admin, { title: `Quorum ${index}`, content: 'x' });
    }

    expect(await listDocs(workspace.admin, { query: 'quorum', limit: 2 })).toHaveLength(2);
    expect(await listDocs(workspace.admin, { query: 'quorum' })).toHaveLength(5);
  });
});
