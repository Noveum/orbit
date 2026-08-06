import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  archiveDoc,
  createDoc,
  createDocCollection,
  createDocComment,
  deleteDocComment,
  getDoc,
  listDocCollections,
  listDocComments,
  listDocs,
  updateDoc,
  updateDocComment,
} from '@orbit/core';
import { DOC_VISIBILITIES } from '@orbit/shared/constants';
import { conflict, notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveProject } from '../resolve.ts';
import { defineTool, publish } from './support.ts';

const docRef = z.string().min(1).describe('A document id, or its exact title.');

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

async function resolveDoc(principal: Principal, ref: string): Promise<string> {
  const needle = ref.trim();
  const rows = await listDocs(principal, {});
  const byId = rows.find((row) => row.id === needle);
  if (byId !== undefined) return byId.id;
  const lowered = needle.toLowerCase();
  const byTitle = rows.filter((row) => row.title.trim().toLowerCase() === lowered);
  const first = byTitle[0];
  if (first === undefined) throw notFound(`No document matches "${ref}".`);
  if (byTitle.length > 1) {
    throw conflict(`More than one document is called "${ref}". Pass the document id instead.`);
  }
  return first.id;
}

export function registerDocTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_docs',
      title: 'List documents',
      description:
        'List the documents this user can read, newest first. Filter by a search query, a project or a collection.',
      readOnly: true,
      inputSchema: {
        query: z.string().trim().max(200).optional().describe('Match against title and body.'),
        project: z.string().min(1).optional().describe('Project name, slug or id.'),
        includeArchived: z.boolean().optional().describe('Include archived documents.'),
      },
    },
    async (args) => {
      const project =
        args.project === undefined ? undefined : (await resolveProject(principal, args.project)).id;
      const rows = await listDocs(principal, {
        ...(args.query === undefined ? {} : { query: args.query }),
        ...(project === undefined ? {} : { projectId: project }),
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
        'Create a document with a Markdown body. Attach it to a project or nest it under a parent document.',
      readOnly: false,
      inputSchema: {
        title: z.string().trim().min(1).max(200).describe('Document title.'),
        content: z.string().max(500_000).optional().describe('Markdown body.'),
        project: z.string().min(1).optional().describe('Project name, slug or id.'),
        parent: docRef.optional().describe('Parent document, making this a nested page.'),
        visibility: visibilityRef.optional(),
      },
    },
    async (args) => {
      const projectId =
        args.project === undefined ? null : (await resolveProject(principal, args.project)).id;
      const parentId = args.parent === undefined ? null : await resolveDoc(principal, args.parent);
      const saved = await createDoc(principal, {
        title: args.title,
        content: args.content ?? '',
        projectId,
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
        'Change a document title, body, project or visibility. Only the fields you pass are touched.',
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
        visibility: visibilityRef.optional(),
      },
    },
    async (args) => {
      const id = await resolveDoc(principal, args.doc);
      let projectId: string | null | undefined;
      if (args.project === null) projectId = null;
      else if (args.project !== undefined)
        projectId = (await resolveProject(principal, args.project)).id;
      const saved = await updateDoc(principal, id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.content === undefined ? {} : { content: args.content }),
        ...(projectId === undefined ? {} : { projectId }),
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
      description: 'Return the folders documents can be filed under.',
      readOnly: true,
      inputSchema: {},
    },
    async () => {
      const rows = await listDocCollections(principal);
      return { collections: rows.map((row) => ({ id: row.id, name: row.name, icon: row.icon })) };
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
}
