import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  archiveDoc,
  createDoc,
  createDocCollection,
  createDocComment,
  type DocPlacement,
  deleteDoc,
  deleteDocCollection,
  deleteDocComment,
  findDocsByRef,
  getDoc,
  listDocCollections,
  listDocComments,
  listDocSiblings,
  listDocs,
  moveDoc,
  plannedPlacement,
  updateDoc,
  updateDocCollection,
  updateDocComment,
} from '@orbit/core';
import { DOC_VISIBILITIES } from '@orbit/shared/constants';
import { conflict, notFound, validationFailed } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveDocCollectionId, resolveProject } from '../resolve.ts';
import { defineTool, publish } from './support.ts';

const docRef = z.string().min(1).describe('A document id, or its exact title.');

const collectionRef = z.string().min(1).describe('A collection id, or its name.');

const visibilityRef = z
  .enum(DOC_VISIBILITIES)
  .describe('Who can reach the document. "workspace" is the usual choice.');

interface DocSummary {
  readonly id: string;
  readonly title: string;
  readonly visibility: string;
  readonly projectId: string | null;
  readonly collectionId: string | null;
  readonly parentId: string | null;
  readonly updatedAt: string;
}

function describeDoc(row: {
  id: string;
  title: string;
  visibility: string;
  projectId: string | null;
  collectionId: string | null;
  parentId: string | null;
  updatedAt: Date;
}): DocSummary {
  return {
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    projectId: row.projectId,
    collectionId: row.collectionId,
    parentId: row.parentId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pickDoc(rows: readonly { id: string; title: string }[], ref: string): string | undefined {
  const needle = ref.trim();
  const byId = rows.find((row) => row.id === needle);
  if (byId !== undefined) return byId.id;
  const first = rows[0];
  if (first === undefined) return undefined;
  if (rows.length > 1) {
    throw conflict(`More than one document is called "${ref}". Pass the document id instead.`);
  }
  return first.id;
}

async function resolveLiveDoc(principal: Principal, ref: string): Promise<string> {
  const found = pickDoc(await findDocsByRef(principal, ref, false), ref);
  if (found === undefined) throw notFound(`No document matches "${ref}".`);
  return found;
}

async function resolveDoc(principal: Principal, ref: string): Promise<string> {
  const live = pickDoc(await findDocsByRef(principal, ref, false), ref);
  if (live !== undefined) return live;
  const archived = pickDoc(await findDocsByRef(principal, ref, true), ref);
  if (archived === undefined) throw notFound(`No document matches "${ref}".`);
  return archived;
}

async function resolveOptional(
  ref: string | null | undefined,
  resolve: (value: string) => Promise<string>,
): Promise<string | null | undefined> {
  if (ref === undefined) return undefined;
  if (ref === null) return null;
  return await resolve(ref);
}

interface Neighbour {
  readonly id: string;
  readonly side: 'after' | 'before';
}

async function neighbourOf(
  principal: Principal,
  after: string | undefined,
  before: string | undefined,
): Promise<Neighbour | null> {
  if (after !== undefined) return { id: await resolveLiveDoc(principal, after), side: 'after' };
  if (before !== undefined) return { id: await resolveLiveDoc(principal, before), side: 'before' };
  return null;
}

interface Anchors {
  readonly beforeId?: string | null;
  readonly afterId?: string | null;
}

function anchorsAround(
  siblings: readonly { id: string }[],
  neighbourId: string,
  side: 'after' | 'before',
): Anchors {
  const index = siblings.findIndex((row) => row.id === neighbourId);
  if (index === -1) {
    throw notFound('That neighbour does not sit where the document is moving to.');
  }
  return side === 'after'
    ? { beforeId: neighbourId, afterId: siblings[index + 1]?.id ?? null }
    : { beforeId: siblings[index - 1]?.id ?? null, afterId: neighbourId };
}

async function landingAnchors(
  principal: Principal,
  docId: string,
  home: DocPlacement,
  neighbourId: string,
  side: 'after' | 'before',
): Promise<Anchors> {
  const siblings = (await listDocSiblings(principal, home)).filter((row) => row.id !== docId);
  return anchorsAround(siblings, neighbourId, side);
}

export function registerDocTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_docs',
      title: 'List documents',
      description:
        'List the documents this user can read, in the order they sit in the sidebar, or by relevance when you pass a query. Filter by a project, by a collection, or to the documents in no collection at all.',
      readOnly: true,
      inputSchema: {
        query: z.string().trim().max(200).optional().describe('Match against title and body.'),
        project: z.string().min(1).optional().describe('Project name, slug or id.'),
        collection: collectionRef
          .optional()
          .describe('Only documents filed under this collection.'),
        unfiled: z.boolean().optional().describe('Only documents that sit in no collection.'),
        includeArchived: z.boolean().optional().describe('Include archived documents.'),
      },
    },
    async (args) => {
      if (args.collection !== undefined && args.unfiled === true) {
        throw validationFailed(
          'Ask for one collection or for the unfiled documents, not both: nothing is in a collection and in none.',
        );
      }
      const project =
        args.project === undefined ? undefined : (await resolveProject(principal, args.project)).id;
      const collectionId =
        args.collection === undefined
          ? undefined
          : await resolveDocCollectionId(principal, args.collection);
      const rows = await listDocs(principal, {
        ...(args.query === undefined ? {} : { query: args.query }),
        ...(project === undefined ? {} : { projectId: project }),
        ...(collectionId === undefined ? {} : { collectionId }),
        ...(args.unfiled === undefined ? {} : { unfiled: args.unfiled }),
        ...(args.includeArchived === undefined ? {} : { includeArchived: args.includeArchived }),
      });
      return { docs: rows.map(describeDoc) };
    },
  );

  defineTool(
    server,
    {
      name: 'get_doc',
      title: 'Read a document',
      description: 'Return a document with its full Markdown body.',
      readOnly: true,
      inputSchema: { doc: docRef },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const detail = await getDoc(principal, id);
      return { doc: { ...describeDoc(detail.doc), content: detail.doc.content } };
    },
  );

  defineTool(
    server,
    {
      name: 'create_doc',
      title: 'Create a document',
      description:
        'Create a document with a Markdown body. File it under a collection, attach it to a project, or nest it under a parent document. A document lives in a collection or in a project, never both.',
      readOnly: false,
      inputSchema: {
        title: z.string().trim().min(1).max(200).describe('Document title.'),
        content: z.string().max(500_000).optional().describe('Markdown body.'),
        project: z.string().min(1).optional().describe('Project name, slug or id.'),
        collection: collectionRef
          .optional()
          .describe('Collection to file the document under. Detaches it from any project.'),
        parent: docRef
          .optional()
          .describe('Parent document, making this a nested page. It inherits the parent home.'),
        visibility: visibilityRef.optional(),
      },
    },
    async (args) => {
      const projectId =
        args.project === undefined ? null : (await resolveProject(principal, args.project)).id;
      const collectionId =
        args.collection === undefined
          ? null
          : await resolveDocCollectionId(principal, args.collection);
      const parentId =
        args.parent === undefined ? null : await resolveLiveDoc(principal, args.parent);
      const saved = await createDoc(principal, {
        title: args.title,
        content: args.content ?? '',
        projectId,
        collectionId,
        parentId,
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
      });
      await publish(saved.actions);
      return { doc: describeDoc(saved.doc) };
    },
  );

  defineTool(
    server,
    {
      name: 'update_doc',
      title: 'Update a document',
      description:
        'Change a document title, body, collection, parent, project or visibility. Only the fields you pass are touched. Filing a document under a collection detaches it from any project, and attaching it to a project unfiles it.',
      readOnly: false,
      inputSchema: {
        doc: docRef,
        title: z.string().trim().min(1).max(200).optional(),
        content: z.string().max(500_000).optional().describe('Replaces the whole Markdown body.'),
        project: z
          .string()
          .min(1)
          .nullable()
          .optional()
          .describe('Project name, slug or id. Pass null to detach.'),
        collection: collectionRef
          .nullable()
          .optional()
          .describe('Collection id or name. Pass null to unfile the document.'),
        parent: docRef
          .nullable()
          .optional()
          .describe('Document id or title to nest under. Pass null to move it to the top level.'),
        visibility: visibilityRef.optional(),
      },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const projectId = await resolveOptional(
        args.project,
        async (ref) => (await resolveProject(principal, ref)).id,
      );
      const collectionId = await resolveOptional(args.collection, (ref) =>
        resolveDocCollectionId(principal, ref),
      );
      const parentId = await resolveOptional(args.parent, (ref) => resolveLiveDoc(principal, ref));
      const saved = await updateDoc(principal, id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.content === undefined ? {} : { content: args.content }),
        ...(projectId === undefined ? {} : { projectId }),
        ...(collectionId === undefined ? {} : { collectionId }),
        ...(parentId === undefined ? {} : { parentId }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
      });
      await publish(saved.actions);
      return { doc: describeDoc(saved.doc) };
    },
  );

  defineTool(
    server,
    {
      name: 'archive_doc',
      title: 'Archive a document',
      description:
        'Archive a document so it leaves the sidebar and the default listings. The content is kept.',
      readOnly: false,
      inputSchema: { doc: docRef },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const saved = await archiveDoc(principal, id);
      await publish(saved.actions);
      return { archived: describeDoc(saved.doc) };
    },
  );

  defineTool(
    server,
    {
      name: 'list_doc_comments',
      title: 'List comments on a document',
      description: 'Return the comment thread on a document, oldest first.',
      readOnly: true,
      inputSchema: { doc: docRef },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const page = await listDocComments(principal, id);
      return {
        comments: page.comments.map((row) => ({
          id: row.id,
          body: row.body,
          authorId: row.authorId,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'comment_on_doc',
      title: 'Comment on a document',
      description: 'Add a Markdown comment to a document.',
      readOnly: false,
      inputSchema: { doc: docRef, body: z.string().min(1).max(50_000).describe('Markdown body.') },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const saved = await createDocComment(principal, id, { body: args.body });
      await publish(saved.actions);
      return { comment: { id: saved.comment.id, body: saved.comment.body } };
    },
  );

  defineTool(
    server,
    {
      name: 'edit_doc_comment',
      title: 'Edit a document comment',
      description: 'Rewrite the body of a comment this user wrote on a document.',
      readOnly: false,
      inputSchema: {
        commentId: z.string().min(1).describe('The comment id.'),
        body: z.string().min(1).max(50_000).describe('Replacement Markdown body.'),
      },
    },
    async (args) => {
      const saved = await updateDocComment(principal, args.commentId, { body: args.body });
      await publish(saved.actions);
      return { comment: { id: saved.comment.id, body: saved.comment.body } };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_doc_comment',
      title: 'Delete a document comment',
      description: 'Remove a comment from a document.',
      readOnly: false,
      inputSchema: { commentId: z.string().min(1).describe('The comment id.') },
    },
    async (args) => {
      const actions = await deleteDocComment(principal, args.commentId);
      await publish(actions);
      return { deleted: args.commentId };
    },
  );

  defineTool(
    server,
    {
      name: 'list_doc_collections',
      title: 'List document collections',
      description:
        'Return the folders documents can be filed under, with how many documents each holds.',
      readOnly: true,
      inputSchema: {},
    },
    async () => {
      const rows = await listDocCollections(principal);
      return {
        collections: rows.map((row) => ({
          id: row.id,
          name: row.name,
          icon: row.icon,
          docCount: row.docCount,
          position: row.position,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'create_doc_collection',
      title: 'Create a document collection',
      description: 'Create a folder that documents can be filed under.',
      readOnly: false,
      inputSchema: {
        name: z.string().trim().min(1).max(120).describe('Collection name.'),
        icon: z.string().trim().min(1).max(32).optional().describe('Lucide icon name.'),
      },
    },
    async (args) => {
      const saved = await createDocCollection(principal, {
        name: args.name,
        ...(args.icon === undefined ? {} : { icon: args.icon }),
      });
      await publish(saved.actions);
      return { collection: { id: saved.collection.id, name: saved.collection.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'update_doc_collection',
      title: 'Rename a document collection',
      description: 'Change the name or the icon of a folder.',
      readOnly: false,
      inputSchema: {
        collection: collectionRef,
        name: z.string().trim().min(1).max(120).optional().describe('New collection name.'),
        icon: z.string().trim().min(1).max(32).optional().describe('Lucide icon name.'),
      },
    },
    async (args) => {
      const id = await resolveDocCollectionId(principal, args.collection);
      const saved = await updateDocCollection(principal, id, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.icon === undefined ? {} : { icon: args.icon }),
      });
      await publish(saved.actions);
      return {
        collection: {
          id: saved.collection.id,
          name: saved.collection.name,
          icon: saved.collection.icon,
        },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_doc_collection',
      title: 'Delete a document collection',
      description:
        'Delete a folder. The documents inside are never deleted: they move to reassignTo, or become unfiled when you leave it out.',
      readOnly: false,
      inputSchema: {
        collection: collectionRef,
        reassignTo: collectionRef
          .optional()
          .describe('Collection the documents inside should move to. Omit to leave them unfiled.'),
      },
    },
    async (args) => {
      const id = await resolveDocCollectionId(principal, args.collection);
      const reassignToId =
        args.reassignTo === undefined
          ? null
          : await resolveDocCollectionId(principal, args.reassignTo);
      const actions = await deleteDocCollection(principal, id, reassignToId);
      await publish(actions);
      return { deleted: id, reassignedTo: reassignToId };
    },
  );

  defineTool(
    server,
    {
      name: 'move_doc',
      title: 'Move a document',
      description:
        'File a document under a collection, nest it under a parent, attach it to a project, or order it against its siblings. One call for what dragging it in the sidebar does.',
      readOnly: false,
      inputSchema: {
        doc: docRef,
        collection: collectionRef
          .nullable()
          .optional()
          .describe('Collection to file it under. Pass null to unfile it.'),
        parent: docRef
          .nullable()
          .optional()
          .describe('Document to nest under. Pass null to move it to the top level.'),
        project: z
          .string()
          .min(1)
          .nullable()
          .optional()
          .describe('Project name, slug or id. Pass null to detach.'),
        after: docRef.optional().describe('Place it immediately after this sibling.'),
        before: docRef.optional().describe('Place it immediately before this sibling.'),
      },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const collectionId = await resolveOptional(args.collection, (ref) =>
        resolveDocCollectionId(principal, ref),
      );
      const parentId = await resolveOptional(args.parent, (ref) => resolveLiveDoc(principal, ref));
      const projectId = await resolveOptional(
        args.project,
        async (ref) => (await resolveProject(principal, ref)).id,
      );

      const home = await plannedPlacement(principal, id, {
        ...(collectionId === undefined ? {} : { collectionId }),
        ...(parentId === undefined ? {} : { parentId }),
        ...(projectId === undefined ? {} : { projectId }),
      });

      if (args.after !== undefined && args.before !== undefined) {
        throw validationFailed(
          'Name the sibling to land after, or the one to land before, not both.',
        );
      }
      const neighbour = await neighbourOf(principal, args.after, args.before);
      const anchors =
        neighbour === null
          ? {}
          : await landingAnchors(principal, id, home, neighbour.id, neighbour.side);

      const saved = await moveDoc(principal, id, {
        ...(collectionId === undefined ? {} : { collectionId }),
        ...(parentId === undefined ? {} : { parentId }),
        ...(projectId === undefined ? {} : { projectId }),
        ...anchors,
      });
      await publish(saved.actions);
      return { doc: describeDoc(saved.doc) };
    },
  );

  defineTool(
    server,
    {
      name: 'unarchive_doc',
      title: 'Restore an archived document',
      description: 'Bring an archived document back into the sidebar and the default listings.',
      readOnly: false,
      inputSchema: { doc: docRef },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const saved = await archiveDoc(principal, id, false);
      await publish(saved.actions);
      return { doc: describeDoc(saved.doc) };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_doc',
      title: 'Delete a document for good',
      description:
        'Delete a document permanently. Pages nested under it are lifted to its own place rather than deleted. Use archive_doc to hide a document instead of destroying it.',
      readOnly: false,
      inputSchema: { doc: docRef },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      const removed = await deleteDoc(principal, id);
      await publish(removed.actions);
      return { deleted: id, promoted: removed.promoted.map((row) => row.id) };
    },
  );
}
