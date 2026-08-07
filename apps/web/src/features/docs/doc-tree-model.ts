import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';

export const MAX_TREE_DEPTH = 32;

export const PROJECT_GROUP_ID = 'project';
export const PRIVATE_GROUP_ID = 'private';
export const ARCHIVE_GROUP_ID = 'archive';

export interface DocGroup {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly collectionId: string | null;
  readonly droppable: boolean;
  readonly docs: readonly DocSummary[];
}

export interface DocNode {
  readonly doc: DocSummary;
  readonly depth: number;
  readonly childCount: number;
}

export function docDisclosureKey(docId: string): string {
  return `docs:page:${docId}`;
}

export function groupDisclosureKey(groupId: string): string {
  return `docs:group:${groupId}`;
}

export function groupIdOf(doc: DocSummary): string {
  if (doc.collectionId !== null) return doc.collectionId;
  return doc.projectId === null ? PRIVATE_GROUP_ID : PROJECT_GROUP_ID;
}

export function docTreeOf(
  docs: readonly DocSummary[],
  collapsed: ReadonlySet<string> = new Set(),
): DocNode[] {
  const present = new Set(docs.map((doc) => doc.id));
  const byParent = new Map<string, DocSummary[]>();
  const rootKey = '';

  for (const doc of docs) {
    const parent = doc.parentId !== null && present.has(doc.parentId) ? doc.parentId : rootKey;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(doc);
    byParent.set(parent, siblings);
  }

  const nodes: DocNode[] = [];
  const seen = new Set<string>();

  const walk = (parent: string, depth: number): void => {
    if (depth >= MAX_TREE_DEPTH) return;
    for (const doc of byParent.get(parent) ?? []) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const childCount = (byParent.get(doc.id) ?? []).length;
      nodes.push({ doc, depth, childCount });
      if (childCount > 0 && !collapsed.has(doc.id)) walk(doc.id, depth + 1);
    }
  };

  walk(rootKey, 0);
  return nodes;
}

export function ancestorsOf(docs: readonly DocSummary[], docId: string): string[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const chain: string[] = [];
  let cursor = byId.get(docId)?.parentId ?? null;
  let depth = 0;
  while (cursor !== null && depth < MAX_TREE_DEPTH) {
    chain.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
    depth += 1;
  }
  return chain;
}

export function groupDocs(
  docs: readonly DocSummary[],
  collections: readonly DocCollection[],
): DocGroup[] {
  const groups: DocGroup[] = collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    icon: collection.icon,
    collectionId: collection.id,
    droppable: true,
    docs: docs.filter((doc) => doc.collectionId === collection.id),
  }));

  const projectDocs = docs.filter((doc) => doc.collectionId === null && doc.projectId !== null);
  if (projectDocs.length > 0) {
    groups.push({
      id: PROJECT_GROUP_ID,
      name: 'Project docs',
      icon: 'folder',
      collectionId: null,
      droppable: false,
      docs: projectDocs,
    });
  }

  groups.push({
    id: PRIVATE_GROUP_ID,
    name: 'Private',
    icon: 'lock',
    collectionId: null,
    droppable: true,
    docs: docs.filter((doc) => doc.collectionId === null && doc.projectId === null),
  });

  return groups;
}

export function breadcrumbOf(
  docs: readonly DocSummary[],
  collections: readonly DocCollection[],
  docId: string,
): string[] {
  const doc = docs.find((entry) => entry.id === docId);
  if (doc === undefined) return [];
  const folder = collections.find((entry) => entry.id === doc.collectionId)?.name;
  const parents = ancestorsOf(docs, docId)
    .map((id) => docs.find((entry) => entry.id === id)?.title)
    .filter((title): title is string => title !== undefined)
    .reverse();
  return folder === undefined ? parents : [folder, ...parents];
}
