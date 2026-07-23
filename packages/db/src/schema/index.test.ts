import { describe, expect, it } from 'bun:test';
import { SYNC_MODELS } from '@orbit/shared/events';
import { getTableColumns, type Table } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from './index.ts';

function tableExportName(model: string): string {
  return model.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
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

  it('searches issues and docs through trigram indexes', () => {
    const trigramIndexes = [
      ...getTableConfig(schema.issue).indexes,
      ...getTableConfig(schema.doc).indexes,
    ].filter((entry) => entry.config.method === 'gin');
    expect(trigramIndexes.map((entry) => entry.config.name)).toEqual([
      'issue_title_trgm_idx',
      'issue_description_trgm_idx',
      'doc_title_trgm_idx',
      'doc_content_trgm_idx',
    ]);
  });

  it('resolves membership and project teams from their own indexes', () => {
    expect(indexNamesOf(schema.member)).toContain('member_user_idx');
    expect(indexNamesOf(schema.projectTeam)).toContain('project_team_team_idx');
  });
});

describe('domain invariants', () => {
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
    expect(indexNamesOf(schema.reaction)).toContain('reaction_comment_unique');
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
