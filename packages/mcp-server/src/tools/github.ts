import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getIssue } from '@orbit/core';
import { and, db, desc, eq, schema } from '@orbit/db';
import {
  linkGithubRepository,
  listGithubCatalogue,
  unlinkGithubRepository,
} from '@orbit/services/github';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveProject } from '../resolve.ts';
import { defineTool } from './support.ts';

const repositoryRef = z
  .string()
  .min(1)
  .describe('Repository full name like "Noveum/orbit", or the GitHub repository id.');

const projectRef = z
  .string()
  .min(1)
  .nullable()
  .optional()
  .describe(
    'Project name or id to associate the repository with. Null or omitted associates it with the whole workspace instead, which is what you want when a repository serves more than one project.',
  );

interface CatalogueEntry {
  readonly repositoryId: string;
  readonly fullName: string;
  readonly links: readonly { readonly projectId: string | null }[];
}

function matches(entry: CatalogueEntry, ref: string): boolean {
  return entry.fullName.toLowerCase() === ref.toLowerCase() || entry.repositoryId === ref;
}

async function repositoryIdFor(principal: Principal, ref: string): Promise<string> {
  const catalogue = await listGithubCatalogue(db, principal.organizationId);
  const found = catalogue.find((entry) => matches(entry, ref));
  if (found === undefined) {
    throw notFound(
      `No connected repository matches "${ref}". Use list_github_repositories to see what this workspace has installed.`,
    );
  }
  return found.repositoryId;
}

async function projectIdFor(
  principal: Principal,
  ref: string | null | undefined,
): Promise<string | null> {
  if (ref === null || ref === undefined) return null;
  const project = await resolveProject(principal, ref);
  return project.id;
}

export function registerGithubTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_github_repositories',
      title: 'List connected GitHub repositories',
      description:
        'Every repository the GitHub App is installed on for this workspace, with the projects each one is associated with. A repository associated with no project is watched at workspace level. Pull requests are matched to issues by the issue identifier in the branch name, title or description, not by which project a repository belongs to, so associations here are for organising the workspace rather than for routing.',
      readOnly: true,
      inputSchema: {},
    },
    async () => {
      assertCan(principal, 'integration:manage');
      const catalogue = await listGithubCatalogue(db, principal.organizationId);
      return {
        repositories: catalogue.map((entry) => ({
          repositoryId: entry.repositoryId,
          fullName: entry.fullName,
          private: entry.private,
          archived: entry.archived,
          defaultBranch: entry.defaultBranch,
          url: entry.htmlUrl,
          account: entry.accountLogin,
          projectIds: entry.links.map((link) => link.projectId).filter((id) => id !== null),
          workspaceWide: entry.links.some((link) => link.projectId === null),
          associated: entry.links.length > 0,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'link_github_repository',
      title: 'Associate a GitHub repository',
      description:
        'Associate a connected repository with a project, or with the whole workspace when no project is given. A project may have many repositories and a repository may serve many projects. Associating also starts watching the repository, which is what lets its pull request and check events reach Orbit.',
      readOnly: false,
      inputSchema: {
        repository: repositoryRef,
        project: projectRef,
      },
    },
    async (args) => {
      assertCan(principal, 'integration:manage');
      const repositoryId = await repositoryIdFor(principal, args.repository);
      const projectId = await projectIdFor(principal, args.project);

      const link = await linkGithubRepository(db, {
        organizationId: principal.organizationId,
        repositoryId,
        projectId,
        linkedById: principal.userId,
      });

      return {
        linked: { repositoryId, projectId: link.projectId, workspaceWide: link.projectId === null },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'unlink_github_repository',
      title: 'Remove a GitHub repository association',
      description:
        'Remove the association between a repository and a project, or the workspace level association when no project is given. Removing the last association stops Orbit watching the repository, so its events are no longer processed.',
      readOnly: false,
      inputSchema: {
        repository: repositoryRef,
        project: projectRef,
      },
    },
    async (args) => {
      assertCan(principal, 'integration:manage');
      const repositoryId = await repositoryIdFor(principal, args.repository);
      const projectId = await projectIdFor(principal, args.project);

      const removed = await unlinkGithubRepository(db, {
        organizationId: principal.organizationId,
        repositoryId,
        projectId,
      });

      return { unlinked: removed, repositoryId, projectId };
    },
  );

  defineTool(
    server,
    {
      name: 'list_issue_pull_requests',
      title: 'List the pull requests linked to an issue',
      description:
        'The pull requests Orbit has linked to an issue, with the branch each one is on. A link is created when a pull request names the issue identifier in its branch name, title or description, so copy_branch_name produces a branch that links itself. Requires only the permission to read the issue, matching what the issue page itself shows.',
      readOnly: true,
      inputSchema: {
        issue: z.string().min(1).describe('Issue identifier like "ENG-42", or an issue id.'),
      },
    },
    async (args) => {
      assertCan(principal, 'issue:read');
      const issue = await getIssue(principal, args.issue);
      const rows = await db
        .select()
        .from(schema.gitLink)
        .where(
          and(
            eq(schema.gitLink.organizationId, principal.organizationId),
            eq(schema.gitLink.issueId, issue.id),
            eq(schema.gitLink.kind, 'pull_request'),
          ),
        )
        .orderBy(desc(schema.gitLink.createdAt));

      return {
        issue: issue.identifier,
        links: rows.map((row) => ({
          kind: row.kind,
          repository: row.repository,
          number: row.number,
          title: row.title,
          url: row.url,
          branch: row.branch,
          state: row.state,
          draft: row.draft,
          merged: row.merged,
        })),
      };
    },
  );
}
