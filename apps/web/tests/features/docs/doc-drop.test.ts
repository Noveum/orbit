import { describe, expect, it } from 'bun:test';
import { edgeFor, planDocDrop, subtreeOf } from '@/features/docs/doc-drop.ts';
import { PRIVATE_GROUP_ID, PROJECT_GROUP_ID } from '@/features/docs/doc-tree-model.ts';
import type { DocSummary } from '@/lib/query/schemas.ts';

function doc(id: string, overrides: Partial<DocSummary> = {}): DocSummary {
  return {
    id,
    organizationId: 'org',
    collectionId: null,
    projectId: null,
    parentId: null,
    title: id,
    slug: id,
    content: '',
    sortOrder: 0,
    visibility: 'workspace',
    publishToken: null,
    authorId: 'user',
    repoBinding: null,
    syncId: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    excerpt: '',
    snippet: '',
    titleMatch: false,
    rank: 0,
    ...overrides,
  } as DocSummary;
}

describe('subtreeOf', () => {
  it('collects the doc and everything under it', () => {
    const docs = [doc('a'), doc('b', { parentId: 'a' }), doc('c', { parentId: 'b' }), doc('d')];

    expect([...subtreeOf(docs, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('planDocDrop', () => {
  it('moves a doc into a folder and puts it after the docs already there', () => {
    const docs = [doc('resident', { collectionId: 'specs' }), doc('mover')];

    const move = planDocDrop(docs, 'mover', { kind: 'group', id: 'specs', edge: 'inside' });

    expect(move).toEqual({
      docId: 'mover',
      collectionId: 'specs',
      projectId: null,
      parentId: null,
      beforeId: 'resident',
      afterId: null,
    });
  });

  it('moves a doc out of a folder when it lands on Private', () => {
    const docs = [doc('mover', { collectionId: 'specs' })];

    const move = planDocDrop(docs, 'mover', {
      kind: 'group',
      id: PRIVATE_GROUP_ID,
      edge: 'inside',
    });

    expect(move?.collectionId).toBeNull();
    expect(move?.parentId).toBeNull();
  });

  it('refuses a drop on the project group, which names no project', () => {
    const docs = [doc('mover')];

    expect(
      planDocDrop(docs, 'mover', { kind: 'group', id: PROJECT_GROUP_ID, edge: 'inside' }),
    ).toBeNull();
  });

  it('nests a doc under the page it was dropped onto and adopts its folder', () => {
    const docs = [doc('parent', { collectionId: 'specs' }), doc('mover')];

    const move = planDocDrop(docs, 'mover', { kind: 'doc', id: 'parent', edge: 'inside' });

    expect(move?.parentId).toBe('parent');
    expect(move?.collectionId).toBe('specs');
  });

  it('places a doc above the row it was dropped on', () => {
    const docs = [doc('first'), doc('second'), doc('mover')];

    const move = planDocDrop(docs, 'mover', { kind: 'doc', id: 'second', edge: 'above' });

    expect(move?.beforeId).toBe('first');
    expect(move?.afterId).toBe('second');
  });

  it('places a doc below the row it was dropped on', () => {
    const docs = [doc('first'), doc('second'), doc('third')];

    const move = planDocDrop(docs, 'third', { kind: 'doc', id: 'first', edge: 'below' });

    expect(move?.beforeId).toBe('first');
    expect(move?.afterId).toBe('second');
  });

  it('adopts the parent of the row it was dropped beside', () => {
    const docs = [doc('parent'), doc('child', { parentId: 'parent' }), doc('mover')];

    const move = planDocDrop(docs, 'mover', { kind: 'doc', id: 'child', edge: 'below' });

    expect(move?.parentId).toBe('parent');
  });

  it('refuses to nest a doc inside its own subtree', () => {
    const docs = [doc('root'), doc('child', { parentId: 'root' })];

    expect(planDocDrop(docs, 'root', { kind: 'doc', id: 'child', edge: 'inside' })).toBeNull();
  });

  it('refuses to drop a doc onto itself', () => {
    const docs = [doc('only')];

    expect(planDocDrop(docs, 'only', { kind: 'doc', id: 'only', edge: 'below' })).toBeNull();
  });

  it('returns nothing for a doc that is not in the tree', () => {
    expect(planDocDrop([doc('a')], 'ghost', { kind: 'doc', id: 'a', edge: 'below' })).toBeNull();
  });

  it('refuses to pull a doc out of a project by dropping it beside a project doc', () => {
    const docs = [doc('owned', { projectId: 'apollo' }), doc('mover')];

    expect(planDocDrop(docs, 'mover', { kind: 'doc', id: 'owned', edge: 'below' })).toBeNull();
  });
});

describe('edgeFor', () => {
  it('splits a nestable row into three bands', () => {
    expect(edgeFor(2, 28, true)).toBe('above');
    expect(edgeFor(14, 28, true)).toBe('inside');
    expect(edgeFor(26, 28, true)).toBe('below');
  });

  it('splits a row that cannot take children in half', () => {
    expect(edgeFor(10, 28, false)).toBe('above');
    expect(edgeFor(20, 28, false)).toBe('below');
  });

  it('treats a zero height row as the top edge', () => {
    expect(edgeFor(0, 0, true)).toBe('above');
  });
});
