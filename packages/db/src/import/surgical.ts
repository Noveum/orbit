import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { db, pool } from '../client.ts';
import { NOVEUM_IMPORT_ORGANIZATION_ID as ORGANIZATION_ID } from '../noveum-workspace.ts';
import * as schema from '../schema/index.ts';
import { createAssetStore } from './assets.ts';
import { combine } from './combine.ts';
import { readLinearExport } from './linear-source.ts';
import { readPlaneExport } from './plane-source.ts';
import { countRows } from './rows.ts';

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

const DELETE_ORDER = [
  'DELETE FROM reaction',
  'DELETE FROM github_comment_sync',
  'DELETE FROM github_issue_sync',
  'DELETE FROM github_pr_state_mapping',
  'DELETE FROM slack_channel_sync',
  'DELETE FROM github_repository_sync',
  'DELETE FROM git_link',
  'DELETE FROM comment',
  'DELETE FROM issue_activity',
  'DELETE FROM issue_subscription',
  'DELETE FROM issue_relation',
  'DELETE FROM issue_label',
  'DELETE FROM issue_identifier_alias',
  'DELETE FROM intake_issue',
  'DELETE FROM intake',
  'DELETE FROM module_issue',
  'DELETE FROM module_member',
  'DELETE FROM module_link',
  'DELETE FROM module',
  'DELETE FROM cycle_progress_snapshot',
  'DELETE FROM favorite',
  'DELETE FROM recent_visit',
  'DELETE FROM home_widget_preference',
  'DELETE FROM doc_comment',
  'DELETE FROM doc_subscription',
  'DELETE FROM doc_version',
  'DELETE FROM doc',
  'DELETE FROM doc_collection',
  'DELETE FROM saved_analytics_view',
  'DELETE FROM view',
  'DELETE FROM notification',
  'DELETE FROM automation_rule',
  'DELETE FROM issue',
  'DELETE FROM milestone',
  'DELETE FROM project_update',
  'DELETE FROM project_team',
  'DELETE FROM project',
  'DELETE FROM cycle',
  'DELETE FROM label',
  'DELETE FROM workflow_state',
  'DELETE FROM team_member',
  'DELETE FROM team',
  "DELETE FROM attachment WHERE parent_type IN ('issue','comment','doc')",
];

const PRESERVED = [
  '"user"',
  'account',
  'session',
  'verification',
  'passkey',
  'member',
  'organization',
  'audit_log',
  'notification_preference',
  'notification_setting',
];

function assertConfirmed(): void {
  if (process.env['CONFIRM_WIPE'] !== '1') {
    throw new Error(
      'Refusing to run surgical load without CONFIRM_WIPE=1. This deletes all task/project/doc data.',
    );
  }
  const url = process.env['DATABASE_URL'] ?? '';
  const host = url.replace(/^[a-z]+:\/\/[^@]*@/i, '').split('/')[0] ?? '(unknown)';
  console.info(`Surgical load target: ${host} (preserving ${PRESERVED.join(', ')})`);
}

async function main(): Promise<void> {
  assertConfirmed();
  const linear = readLinearExport(abs(values.linear));
  const plane = readPlaneExport(abs(values.plane));
  const assets = createAssetStore(abs(values.plane), abs(values.storage), ORGANIZATION_ID);
  const now = new Date();
  const singleTeam =
    process.env['SINGLE_TEAM'] === '1' ? { key: 'NOVEUM', name: 'Noveum' } : undefined;

  const { rows, aliases, stats, flags } = combine(linear, plane, {
    organizationId: ORGANIZATION_ID,
    now,
    assets,
    ...(singleTeam ? { singleTeam } : {}),
  });

  await db.transaction(async (tx) => {
    const existingUsers = await tx
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user);
    const prodIdByEmail = new Map(existingUsers.map((row) => [row.email.toLowerCase(), row.id]));
    const existingMembers = new Set(
      (await tx.select({ userId: schema.member.userId }).from(schema.member)).map(
        (row) => row.userId,
      ),
    );

    const finalIdByCombined = new Map<string, string>();
    const newUsers: typeof rows.users = [];
    for (const user of rows.users) {
      const prodId = prodIdByEmail.get(user.email.toLowerCase());
      if (prodId === undefined) {
        finalIdByCombined.set(user.id, user.id);
        newUsers.push(user);
      } else {
        finalIdByCombined.set(user.id, prodId);
      }
    }
    const remap = (userId: string): string => finalIdByCombined.get(userId) ?? userId;

    const newMembers = rows.members
      .map((member) => ({ ...member, userId: remap(member.userId) }))
      .filter((member) => !existingMembers.has(member.userId));

    const teamMembers = rows.teamMembers.map((row) => ({ ...row, userId: remap(row.userId) }));
    const projects = rows.projects.map((row) => ({
      ...row,
      leadId: row.leadId == null ? null : remap(row.leadId),
    }));
    const issues = rows.issues.map((row) => ({
      ...row,
      creatorId: remap(row.creatorId),
      assigneeId: row.assigneeId == null ? null : remap(row.assigneeId),
    }));
    const comments = rows.comments.map((row) => ({ ...row, authorId: remap(row.authorId) }));
    const docs = rows.docs.map((row) => ({ ...row, authorId: remap(row.authorId) }));
    const attachments = assets.attachments.map((row) => ({
      ...row,
      uploadedById: remap(row.uploadedById),
    }));

    console.info('Deleting old task/project/doc data (preserving members, logs, avatars)...');
    for (const statement of DELETE_ORDER) await tx.execute(sql.raw(statement));

    const insertAll = async <T>(table: Parameters<typeof tx.insert>[0], data: readonly T[]) => {
      for (let index = 0; index < data.length; index += CHUNK) {
        const chunk = data.slice(index, index + CHUNK);
        if (chunk.length > 0) await tx.insert(table).values(chunk as never);
      }
    };

    console.info(`Inserting ${newUsers.length} new users, ${newMembers.length} new members...`);
    await insertAll(schema.user, newUsers);
    await insertAll(schema.member, newMembers);
    await insertAll(schema.team, rows.teams);
    await insertAll(schema.teamMember, teamMembers);
    await insertAll(schema.workflowState, rows.states);
    await insertAll(schema.label, rows.labels);
    await insertAll(schema.project, projects);
    await insertAll(schema.projectTeam, rows.projectTeams);
    await insertAll(schema.cycle, rows.cycles);
    await insertAll(schema.milestone, rows.milestones);

    const parentPairs = issues
      .filter((issue) => issue.parentId != null)
      .map((issue) => ({ id: issue.id, parentId: issue.parentId as string }));
    await insertAll(
      schema.issue,
      issues.map((issue) => ({ ...issue, parentId: null })),
    );
    for (let index = 0; index < parentPairs.length; index += CHUNK) {
      const chunk = parentPairs.slice(index, index + CHUNK);
      if (chunk.length === 0) continue;
      const tuples = chunk.map((pair) => `('${pair.id}','${pair.parentId}')`).join(',');
      await tx.execute(
        sql.raw(
          `UPDATE "issue" AS i SET parent_id = v.parent FROM (VALUES ${tuples}) AS v(id, parent) WHERE i.id = v.id`,
        ),
      );
    }

    await insertAll(schema.issueIdentifierAlias, aliases);
    await insertAll(schema.issueLabel, rows.issueLabels);
    await insertAll(schema.comment, comments);
    await insertAll(schema.docCollection, rows.collections);
    await insertAll(schema.doc, docs);
    await insertAll(schema.attachment, attachments);
  });

  console.info('Surgical load complete.');
  console.info(countRows(rows));
  console.info('stats', JSON.stringify(stats));
  if (flags.length > 0) for (const flag of flags) console.info('  -', flag);
}

await main();
await pool.end();
