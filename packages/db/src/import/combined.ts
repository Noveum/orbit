import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { db, pool } from '../client.ts';
import * as schema from '../schema/index.ts';
import { createAssetStore } from './assets.ts';
import { combine } from './combine.ts';
import { readLinearExport } from './linear-source.ts';
import { readPlaneExport } from './plane-source.ts';
import { countRows, type ImportRows } from './rows.ts';

const ORGANIZATION_ID = 'org_noveum';
const ORGANIZATION_SLUG = 'noveum';
const ORGANIZATION_NAME = 'Noveum';
const CHUNK = 400;

const { values } = parseArgs({
  options: {
    linear: { type: 'string', default: 'extras/import/linear' },
    plane: { type: 'string', default: 'extras/import/plane' },
    storage: { type: 'string', default: process.env['STORAGE_LOCAL_DIR'] ?? './uploads' },
  },
});

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const abs = (value: string): string =>
  isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
const LINEAR = abs(values.linear);
const PLANE = abs(values.plane);
const STORAGE = abs(values.storage);

const RESET_TABLES = [
  'reaction',
  'comment',
  'attachment',
  'doc_subscription',
  'doc',
  'doc_collection',
  'favorite',
  'recent_visit',
  'home_widget_preference',
  'notification',
  'notification_preference',
  'notification_setting',
  'email_delivery',
  'audit_log',
  'api_key',
  'mcp_grant',
  'oauth_access_token',
  'oauth_consent',
  'oauth_application',
  'webhook_delivery',
  'automation_rule',
  'git_link',
  'integration_channel',
  'integration',
  'issue_identifier_alias',
  'issue_activity',
  'issue_subscription',
  'issue_relation',
  'issue_label',
  'intake_issue',
  'intake',
  'module_issue',
  'module_link',
  'module_member',
  'module',
  'cycle_progress_snapshot',
  'issue',
  'view',
  'saved_analytics_view',
  'milestone',
  'project_update',
  'project_team',
  'project',
  'cycle',
  'label',
  'workflow_state',
  'team_member',
  'team',
  'invitation',
  'member',
  'organization',
  'passkey',
  'account',
  'session',
  'verification',
  '"user"',
];

function assertLocalTarget(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  const looksProd =
    url.includes('15432') ||
    /amazonaws|rds|\.internal|prod/i.test(url) ||
    !/localhost|127\.0\.0\.1/.test(url);
  if (looksProd) {
    throw new Error(
      `Refusing to run the full-reset importer: DATABASE_URL does not look like a local dev database. ` +
        `Set it explicitly to the local dev DB (e.g. postgres://orbit:orbit@localhost:5434/orbit).`,
    );
  }
}

async function reset(): Promise<void> {
  assertLocalTarget();
  await db.execute(sql.raw(`TRUNCATE TABLE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`));
  await db.execute(sql.raw('ALTER SEQUENCE sync_id_seq RESTART WITH 1'));
}

async function insertAll<T>(
  table: Parameters<typeof db.insert>[0],
  values: readonly T[],
): Promise<void> {
  for (let index = 0; index < values.length; index += CHUNK) {
    const chunk = values.slice(index, index + CHUNK);
    if (chunk.length > 0) await db.insert(table).values(chunk as never);
  }
}

async function writeRows(
  rows: ImportRows,
  aliases: { id: string; organizationId: string; identifier: string; issueId: string }[],
  attachments: (typeof schema.attachment.$inferInsert)[],
): Promise<void> {
  await insertAll(schema.user, rows.users);
  await insertAll(schema.member, rows.members);
  await insertAll(schema.team, rows.teams);
  await insertAll(schema.teamMember, rows.teamMembers);
  await insertAll(schema.workflowState, rows.states);
  await insertAll(schema.label, rows.labels);
  await insertAll(schema.project, rows.projects);
  await insertAll(schema.projectTeam, rows.projectTeams);
  await insertAll(schema.cycle, rows.cycles);
  await insertAll(schema.milestone, rows.milestones);

  const parentPairs = rows.issues
    .filter((issue) => issue.parentId != null)
    .map((issue) => ({ id: issue.id, parentId: issue.parentId as string }));
  await insertAll(
    schema.issue,
    rows.issues.map((issue) => ({ ...issue, parentId: null })),
  );
  for (let index = 0; index < parentPairs.length; index += CHUNK) {
    const chunk = parentPairs.slice(index, index + CHUNK);
    if (chunk.length === 0) continue;
    const tuples = chunk.map((pair) => `('${pair.id}','${pair.parentId}')`).join(',');
    await db.execute(
      sql.raw(
        `UPDATE "issue" AS i SET parent_id = v.parent FROM (VALUES ${tuples}) AS v(id, parent) WHERE i.id = v.id`,
      ),
    );
  }

  await insertAll(schema.issueIdentifierAlias, aliases);
  await insertAll(schema.issueLabel, rows.issueLabels);
  await insertAll(schema.comment, rows.comments);
  await insertAll(schema.docCollection, rows.collections);
  await insertAll(schema.doc, rows.docs);
  await insertAll(schema.attachment, attachments);
}

async function main(): Promise<void> {
  const linear = readLinearExport(LINEAR);
  const plane = readPlaneExport(PLANE);
  console.info(
    `Linear: ${linear.issues.length} issues, ${linear.projects.length} projects. ` +
      `Plane: ${plane.projects.length} projects.`,
  );

  console.info('Resetting the database (full local rebuild)');
  await reset();

  const now = new Date();
  const floor = linear.issues.reduce<Date>((oldest, issue) => {
    const created = new Date(issue.createdAt);
    return !Number.isNaN(created.getTime()) && created < oldest ? created : oldest;
  }, now);

  await db
    .insert(schema.organization)
    .values({
      id: ORGANIZATION_ID,
      name: ORGANIZATION_NAME,
      slug: ORGANIZATION_SLUG,
      logo: null,
      allowedEmailDomains: ['noveum.ai'],
      createdAt: floor,
    })
    .onConflictDoNothing();

  const assets = createAssetStore(PLANE, STORAGE, ORGANIZATION_ID);
  const singleTeam =
    process.env['SINGLE_TEAM'] === '1' ? { key: 'NOVEUM', name: 'Noveum' } : undefined;
  const { rows, aliases, stats, flags } = combine(linear, plane, {
    organizationId: ORGANIZATION_ID,
    now,
    assets,
    ...(singleTeam ? { singleTeam } : {}),
  });

  await writeRows(rows, aliases, assets.attachments);

  console.info(countRows(rows));
  console.info(`${aliases.length} identifier aliases, ${assets.attachments.length} images copied`);
  console.info('stats', JSON.stringify(stats));
  if (flags.length > 0) {
    console.info('flags:');
    for (const flag of flags) console.info('  -', flag);
  }
}

await main();
await pool.end();
