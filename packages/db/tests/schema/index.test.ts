import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { SYNC_MODELS } from '@orbit/shared/events';
import { getTableColumns, type SQL, type Table } from 'drizzle-orm';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../src/schema/index.ts';

type IndexConfig = ReturnType<typeof getTableConfig>['indexes'][number]['config'];

function tableExportName(model: string): string {
  return model.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function partialIndexOf(table: PgTable, name: string): IndexConfig {
  const config = getTableConfig(table)
    .indexes.map((entry) => entry.config)
    .find((entry) => entry.name === name && entry.where !== undefined);
  if (config === undefined) throw new Error(`${name} is not a partial index on this table.`);
  return config;
}

function predicateOf(config: IndexConfig): string {
  const where = config.where;
  if (where === undefined) throw new Error(`${String(config.name)} carries no predicate.`);
  return new PgDialect().sqlToQuery(where).sql;
}

function columnNamesOf(config: IndexConfig): string[] {
  return config.columns.map((column) => (column as { name?: string }).name ?? '');
}

function indexNamesOf(table: PgTable): string[] {
  return getTableConfig(table)
    .indexes.map((entry) => entry.config.name)
    .filter((name): name is string => name !== undefined);
}

function partialIndexNamesOf(table: PgTable): string[] {
  return getTableConfig(table)
    .indexes.filter((entry) => entry.config.where !== undefined)
    .map((entry) => entry.config.name)
    .filter((name): name is string => name !== undefined);
}

function deleteActionOf(table: PgTable, column: string): string | undefined {
  return getTableConfig(table).foreignKeys.find((key) =>
    key.reference().columns.some((entry) => entry.name === column),
  )?.onDelete;
}

describe('sync schema', () => {
  it('exposes a sync id column for every synced model', () => {
    const tables = schema as unknown as Record<string, Table | undefined>;
    for (const model of SYNC_MODELS) {
      const table = tables[tableExportName(model)];
      expect(table, model).toBeDefined();
      expect(Object.keys(getTableColumns(table as Table)), model).toContain('syncId');
    }
  });
});

describe('list and search indexes', () => {
  it('orders and filters issues from partial indexes that skip archived rows', () => {
    expect(partialIndexNamesOf(schema.issue)).toEqual(
      expect.arrayContaining([
        'issue_team_order_idx',
        'issue_team_updated_idx',
        'issue_team_created_idx',
        'issue_milestone_idx',
      ]),
    );
  });

  it('searches issues and docs through gin indexes, never a scan', () => {
    const ginIndexes = [
      ...getTableConfig(schema.issue).indexes,
      ...getTableConfig(schema.doc).indexes,
    ].filter((entry) => entry.config.method === 'gin');
    expect(ginIndexes.map((entry) => entry.config.name)).toEqual([
      'issue_title_trgm_idx',
      'issue_description_trgm_idx',
      'doc_title_trgm_idx',
      'doc_content_trgm_idx',
      'doc_search_idx',
    ]);
  });

  it('ranks doc search from a stored vector that weighs the title above the body', () => {
    const vector = getTableConfig(schema.doc).columns.find(
      (column) => column.name === 'search_vector',
    );
    const generated = JSON.stringify(vector?.generated?.as ?? '');

    expect(vector).toBeDefined();
    expect(generated).toContain("setweight(to_tsvector('english', coalesce(title, '')), 'A')");
    expect(generated).toContain(
      "setweight(to_tsvector('english', left(coalesce(content, ''), 200000)), 'B')",
    );
  });

  it('bounds the body it indexes, so a long doc never outgrows a tsvector and becomes unsavable', () => {
    const vector = getTableConfig(schema.doc).columns.find(
      (column) => column.name === 'search_vector',
    );

    expect(JSON.stringify(vector?.generated?.as ?? '')).toContain("left(coalesce(content, ''),");
  });

  it('replays sprint scope changes from a partial index over cycle moves', () => {
    const index = partialIndexOf(schema.issueActivity, 'issue_activity_cycle_moves_idx');
    expect(columnNamesOf(index)).toEqual(['organization_id', 'created_at']);
    expect(predicateOf(index)).toBe(`"issue_activity"."field" = 'cycleId'`);
  });

  it('creates that index from the catchup sql on the columns and predicate the schema declares', async () => {
    const index = partialIndexOf(schema.issueActivity, 'issue_activity_cycle_moves_idx');
    const predicate = predicateOf(index).replaceAll('"issue_activity".', '').replaceAll('"', '');
    const catchup = await readFile(
      new URL('../../catchup/sprint-scope-index-catchup.sql', import.meta.url),
      'utf8',
    );
    const statements = [...catchup.matchAll(/create index[\s\S]*?;/g)].map((match) =>
      match[0].replace(/\s+/g, ' '),
    );
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toContain('issue_activity_cycle_moves_idx');
      expect(statement).toContain(`(${columnNamesOf(index).join(', ')})`);
      expect(statement).toContain(`where ${predicate};`);
    }
  });

  it('resolves membership and project teams from their own indexes', () => {
    expect(indexNamesOf(schema.member)).toContain('member_user_idx');
    expect(indexNamesOf(schema.projectTeam)).toContain('project_team_team_idx');
  });
});

describe('domain invariants', () => {
  it('records a durable workspace deletion request', () => {
    const deletionRequestedAt = getTableColumns(schema.organization).deletionRequestedAt;
    expect(deletionRequestedAt?.name).toBe('deletion_requested_at');
    expect(deletionRequestedAt?.notNull).toBe(false);
  });

  it('tracks the expiration of presigned attachment targets', () => {
    const uploadExpiresAt = getTableColumns(schema.attachment).uploadExpiresAt;
    expect(uploadExpiresAt?.name).toBe('upload_expires_at');
    expect(uploadExpiresAt?.default).toBeDefined();
    expect(new PgDialect().sqlToQuery(uploadExpiresAt?.default as SQL).sql).toBe(
      "now() + interval '900 seconds'",
    );
  });

  it('keeps authored rows when their author is deleted', () => {
    expect(deleteActionOf(schema.issue, 'creator_id')).toBe('restrict');
    expect(deleteActionOf(schema.comment, 'author_id')).toBe('restrict');
    expect(deleteActionOf(schema.doc, 'author_id')).toBe('restrict');
    expect(deleteActionOf(schema.projectUpdate, 'author_id')).toBe('restrict');
    expect(deleteActionOf(schema.attachment, 'uploaded_by_id')).toBe('restrict');
  });

  it('clears the issue parent link instead of orphaning it', () => {
    expect(deleteActionOf(schema.issue, 'parent_id')).toBe('set null');
  });

  it('keeps one reaction per comment, user, and emoji', () => {
    const index = getTableConfig(schema.reaction).indexes.find(
      (entry) => entry.config.name === 'reaction_comment_unique',
    );
    expect(index?.config.unique).toBe(true);
    expect(
      (index?.config.columns ?? []).map((column) => (column as { name?: string }).name),
    ).toEqual(['comment_id', 'user_id', 'emoji']);
  });

  it('scopes every soft deletable uniqueness rule to live rows', () => {
    expect(partialIndexNamesOf(schema.team)).toContain('team_org_key_active_unique');
    expect(partialIndexNamesOf(schema.project)).toContain('project_org_slug_active_unique');
    expect(partialIndexNamesOf(schema.module)).toContain('module_team_name_active_unique');
    expect(partialIndexNamesOf(schema.estimateScale)).toContain(
      'estimate_scale_org_name_active_unique',
    );
    expect(partialIndexNamesOf(schema.invitation)).toContain('invitation_org_email_pending_unique');
  });

  it('names labels once per team and once per organization', () => {
    expect(partialIndexNamesOf(schema.label)).toEqual([
      'label_team_name_unique',
      'label_org_name_unique',
    ]);
  });
});

describe('tables reserved for later streams', () => {
  const reserved = [
    schema.module,
    schema.moduleMember,
    schema.moduleIssue,
    schema.moduleLink,
    schema.cycleProgressSnapshot,
    schema.docVersion,
    schema.issueIdentifierAlias,
    schema.savedAnalyticsView,
    schema.homeWidgetPreference,
    schema.recentVisit,
    schema.intake,
    schema.intakeIssue,
    schema.estimateScale,
    schema.estimatePoint,
    schema.githubRepositorySync,
    schema.githubIssueSync,
    schema.githubCommentSync,
    schema.githubPrStateMapping,
    schema.slackChannelSync,
    schema.webhook,
    schema.webhookLog,
  ];

  it('gives every reserved table an id and a creation timestamp', () => {
    for (const table of reserved) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => column.name);
      expect(columns, config.name).toContain('id');
      expect(columns, config.name).toContain('created_at');
    }
  });

  it('gives every tenant scoped reserved table an organization and a sync id', () => {
    for (const table of reserved) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => column.name);
      if (!columns.includes('organization_id')) continue;
      expect(columns, config.name).toContain('sync_id');
    }
  });
});
