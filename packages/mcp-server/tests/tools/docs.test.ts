import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  connect,
  createWorkspace,
  errorPayload,
  mintToken,
  resetDatabase,
} from '../../src/test-helpers.ts';

type TestClient = Awaited<ReturnType<typeof connect>>;
type TestWorkspace = Awaited<ReturnType<typeof createWorkspace>>;

let workspace: TestWorkspace;
let admin: TestClient;

interface DocShape {
  readonly id: string;
  readonly title: string;
  readonly collectionId: string | null;
  readonly parentId: string | null;
  readonly projectId: string | null;
}

interface CollectionShape {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly docCount: number;
}

async function collectionId(name: string, icon?: string): Promise<string> {
  const payload = await admin.result('create_doc_collection', {
    name,
    ...(icon === undefined ? {} : { icon }),
  });
  return (payload['collection'] as { id: string }).id;
}

async function makeDoc(args: Record<string, unknown>): Promise<DocShape> {
  const payload = await admin.result('create_doc', args);
  return payload['doc'] as DocShape;
}

async function listCollections(): Promise<CollectionShape[]> {
  const payload = await admin.result('list_doc_collections');
  return payload['collections'] as CollectionShape[];
}

async function listDocs(args: Record<string, unknown> = {}): Promise<DocShape[]> {
  const payload = await admin.result('list_docs', args);
  return payload['docs'] as DocShape[];
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
});

afterAll(async () => {
  await admin.close();
});

describe('filing a document into a collection', () => {
  it('creates a document directly into a collection in one call', async () => {
    const infrastructure = await collectionId('Infrastructure');
    const doc = await makeDoc({ title: 'Prod EKS cost', collection: 'Infrastructure' });

    expect(doc.collectionId).toBe(infrastructure);
    expect(await listDocs({ collection: 'Infrastructure' })).toHaveLength(1);
  });

  it('moves a document between collections through update_doc', async () => {
    const archive = await collectionId('Archive');
    await collectionId('Pricing');
    const doc = await makeDoc({ title: 'Old pricing note', collection: 'Pricing' });

    await admin.result('update_doc', { doc: doc.id, collection: 'Archive' });

    expect((await listDocs({ collection: 'Archive' })).map((row) => row.id)).toEqual([doc.id]);
    expect(await listDocs({ collection: 'Pricing' })).toHaveLength(0);
    expect((await listDocs({ collection: 'Archive' }))[0]?.collectionId).toBe(archive);
  });

  it('unfiles a document when collection is null, and finds it again with unfiled', async () => {
    await collectionId('Marketing');
    const doc = await makeDoc({ title: 'SEO plan', collection: 'Marketing' });

    await admin.result('update_doc', { doc: doc.id, collection: null });

    const unfiled = await listDocs({ unfiled: true });
    expect(unfiled.map((row) => row.id)).toContain(doc.id);
    expect(await listDocs({ collection: 'Marketing' })).toHaveLength(0);
  });

  it('resolves a collection by id, by name and by a name differing only in case', async () => {
    const id = await collectionId('Program reports');
    const byId = await makeDoc({ title: 'Week 1', collection: id });
    const byName = await makeDoc({ title: 'Week 2', collection: 'Program reports' });
    const byCase = await makeDoc({ title: 'Week 3', collection: 'PROGRAM REPORTS' });

    expect([byId.collectionId, byName.collectionId, byCase.collectionId]).toEqual([id, id, id]);
  });

  it('refuses an ambiguous collection name instead of silently picking one', async () => {
    await collectionId('Duplicate');
    await collectionId('Duplicate');

    const error = errorPayload(
      await admin.call('create_doc', { title: 'x', collection: 'Duplicate' }),
    );
    expect(error.code).toBe('conflict');
    expect(error.message).toContain('More than one collection');
  });
});

describe('a document lives in one place', () => {
  it('detaches a document from its project when it is filed', async () => {
    const project = await admin.result('create_project', {
      name: 'NovaSynth',
      teams: [workspace.teamKey],
    });
    const projectId = (project['project'] as { id: string }).id;
    await collectionId('Product specs');
    const doc = await makeDoc({ title: 'Module A spec', project: 'NovaSynth' });
    expect(doc.projectId).toBe(projectId);

    const payload = await admin.result('update_doc', { doc: doc.id, collection: 'Product specs' });
    const moved = payload['doc'] as DocShape;

    expect(moved.projectId).toBeNull();
    expect(moved.collectionId).not.toBeNull();
  });

  it('refuses a create that names both a collection and a project', async () => {
    await collectionId('Both');
    const error = errorPayload(
      await admin.call('create_doc', { title: 'x', collection: 'Both', project: 'NovaSynth' }),
    );
    expect(error.code).toBe('validation_failed');
    expect(error.message).toContain('never both');
  });
});

describe('re-parenting', () => {
  it('re-parents a document and moves it back to the top level', async () => {
    const parent = await makeDoc({ title: 'Hub' });
    const child = await makeDoc({ title: 'Leaf' });

    const nested = (await admin.result('update_doc', { doc: child.id, parent: 'Hub' }))[
      'doc'
    ] as DocShape;
    expect(nested.parentId).toBe(parent.id);

    const lifted = (await admin.result('update_doc', { doc: child.id, parent: null }))[
      'doc'
    ] as DocShape;
    expect(lifted.parentId).toBeNull();
  });

  it('refuses to nest a document inside its own child and leaves the tree alone', async () => {
    const root = await makeDoc({ title: 'Ancestor' });
    const child = await makeDoc({ title: 'Descendant', parent: 'Ancestor' });

    const error = errorPayload(await admin.call('update_doc', { doc: root.id, parent: child.id }));
    expect(error.code).toBe('validation_failed');

    const after = (await admin.result('get_doc', { doc: root.id }))['doc'] as DocShape;
    expect(after.parentId).toBeNull();
  });

  it('refuses to nest a document under itself', async () => {
    const doc = await makeDoc({ title: 'Only me' });
    const error = errorPayload(await admin.call('update_doc', { doc: doc.id, parent: doc.id }));
    expect(error.code).toBe('validation_failed');
  });
});

describe('collections', () => {
  it('counts only the documents a collection actually holds', async () => {
    await collectionId('Counted');
    await makeDoc({ title: 'One', collection: 'Counted' });
    await makeDoc({ title: 'Two', collection: 'Counted' });

    const counted = (await listCollections()).find((row) => row.name === 'Counted');
    expect(counted?.docCount).toBe(2);
  });

  it('renames and re-icons a collection', async () => {
    const id = await collectionId('Before', 'book');
    await admin.result('update_doc_collection', { collection: id, name: 'After', icon: 'rocket' });

    const renamed = (await listCollections()).find((row) => row.id === id);
    expect(renamed?.name).toBe('After');
    expect(renamed?.icon).toBe('rocket');
  });

  it('deletes a collection without deleting its documents', async () => {
    const id = await collectionId('Doomed');
    const kept = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((title) => makeDoc({ title, collection: id })),
    );

    await admin.result('delete_doc_collection', { collection: id });

    const unfiled = (await listDocs({ unfiled: true })).map((row) => row.id);
    for (const doc of kept) expect(unfiled).toContain(doc.id);
    expect((await listCollections()).some((row) => row.id === id)).toBe(false);
  });

  it('hands the documents to reassignTo when one is named', async () => {
    const from = await collectionId('Leaving');
    const to = await collectionId('Arriving');
    const moved = await Promise.all(
      ['p', 'q', 'r'].map((title) => makeDoc({ title, collection: from })),
    );

    await admin.result('delete_doc_collection', { collection: from, reassignTo: to });

    const landed = (await listDocs({ collection: to })).map((row) => row.id);
    for (const doc of moved) expect(landed).toContain(doc.id);
  });
});

describe('document lifecycle', () => {
  it('archives and unarchives a document', async () => {
    const doc = await makeDoc({ title: 'Temporarily gone' });

    await admin.result('archive_doc', { doc: doc.id });
    expect((await listDocs()).map((row) => row.id)).not.toContain(doc.id);

    await admin.result('unarchive_doc', { doc: doc.id });
    expect((await listDocs()).map((row) => row.id)).toContain(doc.id);
  });

  it('deletes a document for good and lifts the pages under it', async () => {
    const parent = await makeDoc({ title: 'Going away' });
    const child = await makeDoc({ title: 'Staying', parent: parent.id });

    const payload = await admin.result('delete_doc', { doc: parent.id });
    expect(payload['promoted']).toEqual([child.id]);

    const remaining = await listDocs();
    expect(remaining.map((row) => row.id)).not.toContain(parent.id);
    expect(remaining.find((row) => row.id === child.id)?.parentId).toBeNull();
  });
});

describe('move_doc ordering', () => {
  it('orders a document against a named sibling and the order survives a re-read', async () => {
    const id = await collectionId('Ordered');
    const first = await makeDoc({ title: 'First', collection: id });
    const second = await makeDoc({ title: 'Second', collection: id });
    const third = await makeDoc({ title: 'Third', collection: id });

    await admin.result('move_doc', { doc: third.id, collection: id, after: first.id });

    expect((await listDocs({ collection: id })).map((row) => row.title)).toEqual([
      'First',
      'Third',
      'Second',
    ]);

    await admin.result('move_doc', { doc: first.id, collection: id, before: second.id });

    expect((await listDocs({ collection: id })).map((row) => row.title)).toEqual([
      'Third',
      'First',
      'Second',
    ]);
  });
});

function messageOf(result: Awaited<ReturnType<TestClient['call']>>): string {
  const [first] = result.content;
  return first !== undefined && first.type === 'text' ? first.text : '';
}

describe('unknown parameters', () => {
  it('errors rather than silently dropping an unknown field on a write tool', async () => {
    const result = await admin.call('create_doc', { title: 'Typo', collectio: 'Infrastructure' });

    expect(result.isError).toBe(true);
    expect(messageOf(result)).toContain('collectio');
    expect(await listDocs({ query: 'Typo' })).toHaveLength(0);
  });

  it('errors on an unknown field for a read tool too', async () => {
    const result = await admin.call('list_docs', { collections: 'x' });

    expect(result.isError).toBe(true);
    expect(messageOf(result)).toContain('collections');
  });
});

describe('contradictory filters', () => {
  it('refuses to be asked for one collection and for the unfiled at once', async () => {
    await collectionId('Contradiction');
    const error = errorPayload(
      await admin.call('list_docs', { collection: 'Contradiction', unfiled: true }),
    );
    expect(error.code).toBe('validation_failed');
  });
});

describe('moving under a parent that lives somewhere else', () => {
  it('orders against the siblings of the home it inherits from its new parent', async () => {
    const shelf = await collectionId('Shelf');
    const parent = await makeDoc({ title: 'Binder', collection: shelf });
    const firstChild = await makeDoc({ title: 'Tab one', parent: parent.id });
    const secondChild = await makeDoc({ title: 'Tab two', parent: parent.id });
    const stray = await makeDoc({ title: 'Loose page' });

    await admin.result('move_doc', {
      doc: stray.id,
      parent: parent.id,
      after: firstChild.id,
    });

    const filed = await listDocs({ collection: shelf });
    const nested = filed.filter((row) => row.parentId === parent.id).map((row) => row.title);
    expect(nested).toEqual(['Tab one', 'Loose page', 'Tab two']);
    expect(filed.find((row) => row.id === stray.id)?.collectionId).toBe(shelf);
    expect(secondChild.parentId).toBe(parent.id);
  });
});

describe('anchors', () => {
  it('refuses a move that names a sibling to land after and one to land before', async () => {
    const id = await collectionId('Anchored');
    const first = await makeDoc({ title: 'Anchor one', collection: id });
    const second = await makeDoc({ title: 'Anchor two', collection: id });
    const moving = await makeDoc({ title: 'Anchor three', collection: id });

    const error = errorPayload(
      await admin.call('move_doc', { doc: moving.id, after: first.id, before: second.id }),
    );
    expect(error.code).toBe('validation_failed');
  });

  it('refuses an archived document as a parent', async () => {
    const shelved = await makeDoc({ title: 'Shelved parent' });
    await admin.result('archive_doc', { doc: shelved.id });
    const child = await makeDoc({ title: 'Would nest' });

    const error = errorPayload(await admin.call('move_doc', { doc: child.id, parent: shelved.id }));
    expect(error.code).toBe('not_found');
  });
});
