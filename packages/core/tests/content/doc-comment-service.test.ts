import { beforeEach, describe, expect, it } from 'bun:test';
import { scopes } from '@orbit/shared/events';
import { buildDocAnchor } from '@orbit/shared/utils';
import {
  createDocComment,
  deleteDocComment,
  listDocComments,
  updateDocComment,
} from '../../src/content/doc-comment-service.ts';
import { createDoc, setDocAccess } from '../../src/content/doc-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;
let docId: string;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const { doc } = await createDoc(workspace.admin, { title: 'Runbook', content: '# Runbook' });
  docId = doc.id;
});

async function writeComments(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await createDocComment(workspace.admin, docId, { body: `Comment ${index}` });
  }
}

describe('createDocComment', () => {
  it('stores the comment and emits an insert scoped to the org and the doc', async () => {
    const { comment, actions } = await createDocComment(workspace.admin, docId, {
      body: 'First pass looks solid.',
    });

    expect(comment.docId).toBe(docId);
    expect(comment.authorId).toBe(workspace.admin.userId);
    expect(comment.parentId).toBeNull();
    expect(actions).toHaveLength(1);
    expect(actions[0]?.model).toBe('doc_comment');
    expect(actions[0]?.action).toBe('insert');
    expect(actions[0]?.scopes).toContain(scopes.doc(docId));
    expect(actions[0]?.scopes).toContain(scopes.organization(workspace.organizationId));
    expect(actions[0]?.syncId).toBeGreaterThan(0);
  });

  it('threads a reply one level deep and refuses to nest deeper', async () => {
    const { comment: root } = await createDocComment(workspace.admin, docId, { body: 'Root' });
    const { comment: reply } = await createDocComment(workspace.admin, docId, {
      body: 'Reply',
      parentId: root.id,
    });
    expect(reply.parentId).toBe(root.id);

    await expect(
      createDocComment(workspace.admin, docId, { body: 'Nested', parentId: reply.id }),
    ).rejects.toThrow();
  });
});

describe('anchored doc comments', () => {
  const passage = 'the migration has to land first';
  const anchor = buildDocAnchor(
    `Ship notes\n\n${passage}\n\nEverything else is ready.`,
    12,
    12 + passage.length,
  );

  it('stores the anchor and hands it back when the thread is listed', async () => {
    const { comment } = await createDocComment(workspace.admin, docId, {
      body: 'Which migration?',
      anchor,
    });

    expect(comment.anchor).toEqual(anchor);

    const page = await listDocComments(workspace.admin, docId);
    expect(page.comments[0]?.anchor).toEqual(anchor);
    expect(page.comments[0]?.anchor?.quote).toBe(passage);
  });

  it('still accepts a comment with no anchor and stores it as null', async () => {
    const { comment } = await createDocComment(workspace.admin, docId, {
      body: 'A note about the whole page.',
    });

    expect(comment.anchor).toBeNull();

    const page = await listDocComments(workspace.admin, docId);
    expect(page.comments[0]?.anchor).toBeNull();
  });

  it('lists anchored and unanchored comments side by side', async () => {
    await createDocComment(workspace.admin, docId, { body: 'Whole page', anchor: null });
    await createDocComment(workspace.admin, docId, { body: 'This passage', anchor });

    const page = await listDocComments(workspace.admin, docId);
    expect(page.comments.map((entry) => entry.anchor === null)).toEqual([true, false]);
  });

  it('keeps a reply on the anchor of the comment it answers', async () => {
    const { comment: root } = await createDocComment(workspace.admin, docId, {
      body: 'Which migration?',
      anchor,
    });

    await expect(
      createDocComment(workspace.admin, docId, {
        body: 'This one.',
        parentId: root.id,
        anchor: buildDocAnchor('Something else entirely', 0, 9),
      }),
    ).rejects.toThrow();

    const { comment: reply } = await createDocComment(workspace.admin, docId, {
      body: 'This one.',
      parentId: root.id,
    });
    expect(reply.anchor).toBeNull();
  });

  it('refuses an anchor with an empty quote or a negative position', async () => {
    await expect(
      createDocComment(workspace.admin, docId, {
        body: 'Nothing selected',
        anchor: { quote: '', prefix: '', suffix: '', start: 0 },
      }),
    ).rejects.toThrow();

    await expect(
      createDocComment(workspace.admin, docId, {
        body: 'Impossible position',
        anchor: { quote: passage, prefix: '', suffix: '', start: -4 },
      }),
    ).rejects.toThrow();
  });

  it('publishes the anchor on the sync action so a reader can highlight it', async () => {
    const { actions } = await createDocComment(workspace.admin, docId, {
      body: 'Which migration?',
      anchor,
    });

    expect(actions[0]?.data).toMatchObject({ anchor: { quote: passage } });
  });
});

describe('listDocComments', () => {
  it('returns one bounded page with a cursor for the rest', async () => {
    await writeComments(60);

    const first = await listDocComments(workspace.admin, docId);
    expect(first.comments).toHaveLength(50);
    expect(first.comments[0]?.body).toBe('Comment 0');
    expect(first.nextCursor).not.toBeNull();

    const second = await listDocComments(workspace.admin, docId, { cursor: first.nextCursor });
    expect(second.comments).toHaveLength(10);
    expect(second.comments[0]?.body).toBe('Comment 50');
    expect(second.nextCursor).toBeNull();
  });

  it('omits soft deleted comments', async () => {
    const { comment } = await createDocComment(workspace.admin, docId, { body: 'To delete' });
    await createDocComment(workspace.admin, docId, { body: 'To keep' });

    await deleteDocComment(workspace.admin, comment.id);

    const page = await listDocComments(workspace.admin, docId);
    expect(page.comments).toHaveLength(1);
    expect(page.comments[0]?.body).toBe('To keep');
  });

  it('hides a reply whose root comment was soft deleted', async () => {
    const { comment: root } = await createDocComment(workspace.admin, docId, { body: 'Root' });
    await createDocComment(workspace.admin, docId, { body: 'Reply', parentId: root.id });

    await deleteDocComment(workspace.admin, root.id);

    const page = await listDocComments(workspace.admin, docId);
    expect(page.comments).toHaveLength(0);
  });

  it('rejects a cursor that does not resolve to a comment', async () => {
    await writeComments(3);
    await expect(listDocComments(workspace.admin, docId, { cursor: 'nope' })).rejects.toThrow();
  });
});

describe('doc comment policy', () => {
  it('lets an author edit their own comment and blocks editing someone else', async () => {
    const guest = await addMember(workspace, 'guest');
    const { comment } = await createDocComment(guest.principal, docId, { body: 'Guest note' });

    const edited = await updateDocComment(guest.principal, comment.id, {
      body: 'Guest note edited',
    });
    expect(edited.comment.body).toBe('Guest note edited');
    expect(edited.comment.editedAt).not.toBeNull();

    await expect(
      updateDocComment(workspace.admin, comment.id, { body: 'Not mine' }),
    ).rejects.toThrow();
  });

  it('lets an author delete their own comment but blocks a guest deleting another', async () => {
    const guest = await addMember(workspace, 'guest');
    const { comment: mine } = await createDocComment(guest.principal, docId, { body: 'Mine' });
    const { comment: theirs } = await createDocComment(workspace.admin, docId, { body: 'Theirs' });

    const actions = await deleteDocComment(guest.principal, mine.id);
    expect(actions[0]?.action).toBe('delete');

    await expect(deleteDocComment(guest.principal, theirs.id)).rejects.toThrow();
  });

  it('lets an admin delete a comment written by someone else', async () => {
    const guest = await addMember(workspace, 'guest');
    const { comment } = await createDocComment(guest.principal, docId, { body: 'Guest note' });

    const actions = await deleteDocComment(workspace.admin, comment.id);
    expect(actions[0]?.action).toBe('delete');
    expect(actions[0]?.model).toBe('doc_comment');
  });
});

describe('a private doc keeps its conversation private', () => {
  it('hides the thread from somebody the doc was never shared with', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Compensation review',
      content: 'Bob gets a raise.',
      visibility: 'private',
    });
    await createDocComment(workspace.admin, doc.id, { body: 'Approved by finance.' });
    const { principal: outsider } = await addMember(workspace, 'member');

    await expect(listDocComments(outsider, doc.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      createDocComment(outsider, doc.id, { body: 'Who else is on this list?' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lets somebody the doc was shared with join the thread', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Compensation review',
      content: 'Bob gets a raise.',
      visibility: 'private',
    });
    const { principal: invited, user } = await addMember(workspace, 'member');
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: user.id, level: 'read' }],
    });

    const { comment } = await createDocComment(invited, doc.id, { body: 'Looks right to me.' });
    expect(comment.body).toBe('Looks right to me.');
    expect(await listDocComments(invited, doc.id)).toMatchObject({
      comments: [{ id: comment.id }],
    });
  });

  it('never announces a private doc comment on the workspace channel', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Compensation review',
      content: 'Bob gets a raise.',
      visibility: 'private',
    });
    const { actions } = await createDocComment(workspace.admin, doc.id, { body: 'Approved.' });

    expect(actions[0]?.scopes).toContain(scopes.doc(doc.id));
    expect(actions[0]?.scopes).not.toContain(scopes.organization(workspace.organizationId));
  });

  it('still announces a workspace doc comment to the workspace', async () => {
    const { actions } = await createDocComment(workspace.admin, docId, { body: 'Ship it.' });
    expect(actions[0]?.scopes).toContain(scopes.organization(workspace.organizationId));
  });
});
