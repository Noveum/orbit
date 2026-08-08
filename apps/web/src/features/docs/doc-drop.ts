import type { DocSummary } from '@/lib/query/schemas.ts';
import { PRIVATE_GROUP_ID, PROJECT_GROUP_ID } from './doc-tree-model.ts';

export type DropEdge = 'above' | 'below' | 'inside';

export interface DocDropTarget {
  readonly kind: 'doc' | 'group';
  readonly id: string;
  readonly edge: DropEdge;
}

export interface DocMove {
  readonly docId: string;
  readonly collectionId: string | null;
  readonly projectId: string | null;
  readonly parentId: string | null;
  readonly beforeId: string | null;
  readonly afterId: string | null;
}

interface Home {
  readonly collectionId: string | null;
  readonly projectId: string | null;
  readonly parentId: string | null;
}

export function subtreeOf(docs: readonly DocSummary[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const doc of docs) {
    if (doc.parentId === null) continue;
    children.set(doc.parentId, [...(children.get(doc.parentId) ?? []), doc.id]);
  }

  const inside = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) continue;
    for (const child of children.get(next) ?? []) {
      if (inside.has(child)) continue;
      inside.add(child);
      queue.push(child);
    }
  }
  return inside;
}

function siblingsOf(docs: readonly DocSummary[], home: Home, excludeId: string): DocSummary[] {
  return docs.filter(
    (doc) =>
      doc.id !== excludeId &&
      doc.collectionId === home.collectionId &&
      doc.projectId === home.projectId &&
      doc.parentId === home.parentId,
  );
}

function homeOfGroup(groupId: string): Home | null {
  if (groupId === PROJECT_GROUP_ID) return null;
  if (groupId === PRIVATE_GROUP_ID) {
    return { collectionId: null, projectId: null, parentId: null };
  }
  return { collectionId: groupId, projectId: null, parentId: null };
}

function unchanged(active: DocSummary, home: Home, before: string | null, after: string | null) {
  return (
    active.collectionId === home.collectionId &&
    active.projectId === home.projectId &&
    active.parentId === home.parentId &&
    before === null &&
    after === null
  );
}

export function planDocDrop(
  docs: readonly DocSummary[],
  activeId: string,
  target: DocDropTarget,
): DocMove | null {
  const active = docs.find((doc) => doc.id === activeId);
  if (active === undefined) return null;

  const blocked = subtreeOf(docs, activeId);
  if (target.kind === 'doc' && blocked.has(target.id)) return null;

  const home = homeFor(docs, active, target);
  if (home === null) return null;

  const siblings = siblingsOf(docs, home, activeId);
  const { before, after } = neighboursFor(siblings, target);
  if (unchanged(active, home, before, after) && siblings.length > 0) {
    const last = siblings.at(-1);
    if (last !== undefined && last.id === active.id) return null;
  }

  return {
    docId: activeId,
    collectionId: home.collectionId,
    projectId: home.projectId,
    parentId: home.parentId,
    beforeId: before,
    afterId: after,
  };
}

function homeFor(
  docs: readonly DocSummary[],
  active: DocSummary,
  target: DocDropTarget,
): Home | null {
  if (target.kind === 'group') return homeOfGroup(target.id);

  const row = docs.find((doc) => doc.id === target.id);
  if (row === undefined) return null;
  if (target.edge === 'inside') {
    return { collectionId: row.collectionId, projectId: row.projectId, parentId: row.id };
  }
  if (row.projectId !== null && active.projectId !== row.projectId) return null;
  return { collectionId: row.collectionId, projectId: row.projectId, parentId: row.parentId };
}

function neighboursFor(
  siblings: readonly DocSummary[],
  target: DocDropTarget,
): { before: string | null; after: string | null } {
  if (target.kind === 'group' || target.edge === 'inside') {
    return { before: siblings.at(-1)?.id ?? null, after: null };
  }

  const index = siblings.findIndex((doc) => doc.id === target.id);
  if (index === -1) return { before: siblings.at(-1)?.id ?? null, after: null };

  if (target.edge === 'above') {
    return { before: siblings[index - 1]?.id ?? null, after: siblings[index]?.id ?? null };
  }
  return { before: siblings[index]?.id ?? null, after: siblings[index + 1]?.id ?? null };
}

export function edgeFor(offsetY: number, height: number, nestable: boolean): DropEdge {
  const ratio = height === 0 ? 0 : offsetY / height;
  if (!nestable) return ratio < 0.5 ? 'above' : 'below';
  if (ratio < 0.28) return 'above';
  if (ratio > 0.72) return 'below';
  return 'inside';
}
