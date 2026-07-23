import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { db, pool } from '../client.ts';
import * as schema from '../schema/index.ts';
import { type BuildContext, buildDocs, buildProject } from './build-project.ts';
import { displayNameFor, handleFor, orgRoleFor } from './plane-mapping.ts';
import { type PlaneMember, readPlaneExport } from './plane-source.ts';
import { countRows, emptyRows, type ImportRows } from './rows.ts';

const ORGANIZATION_ID = 'org_noveum';
const ORGANIZATION_SLUG = 'noveum';
const ORGANIZATION_NAME = 'Noveum';
const CHUNK = 400;

const { values } = parseArgs({
  options: {
    input: { type: 'string', default: 'extras/import/plane' },
    keep: { type: 'boolean', default: false },
  },
});

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const INPUT = isAbsolute(values.input) ? values.input : resolve(REPOSITORY_ROOT, values.input);

const RESET_TABLES = [
  'reaction',
  'comment',
  'attachment',
  'doc_subscription',
  'doc',
  'doc_collection',
  'favorite',
  'notification',
  'notification_preference',
  'notification_setting',
  'email_delivery',
  'audit_log',
  'api_key',
  'webhook_delivery',
  'automation_rule',
  'git_link',
  'integration_channel',
  'integration',
  'issue_activity',
  'issue_subscription',
  'issue_relation',
  'issue_label',
  'issue',
  'view',
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

function id(): string {
  return randomUUID();
}

async function reset(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`));
  await db.execute(sql.raw('ALTER SEQUENCE sync_id_seq RESTART WITH 1'));
}

async function insertAll<T>(
  table: Parameters<typeof db.insert>[0],
  rows: readonly T[],
): Promise<void> {
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK);
    if (chunk.length > 0) await db.insert(table).values(chunk as never);
  }
}

function buildUsers(
  members: readonly PlaneMember[],
  createdAt: Date,
  rows: ImportRows,
): { byPlaneId: Map<string, string>; fallbackUserId: string } {
  const handles = new Set<string>();
  const seenEmails = new Map<string, string>();
  const byPlaneId = new Map<string, string>();
  let fallbackUserId = '';

  for (const member of members) {
    const email = member.email.toLowerCase();
    const existing = seenEmails.get(email);
    if (existing !== undefined) {
      byPlaneId.set(member.id, existing);
      continue;
    }

    const userId = id();
    seenEmails.set(email, userId);
    byPlaneId.set(member.id, userId);
    if (fallbackUserId === '' && !member.is_bot) fallbackUserId = userId;

    rows.users.push({
      id: userId,
      name: displayNameFor(member),
      email,
      emailVerified: true,
      image: null,
      handle: handleFor(member, handles),
      timezone: 'Asia/Kolkata',
      createdAt,
      updatedAt: createdAt,
    });

    if (member.is_bot) continue;

    rows.members.push({
      id: id(),
      organizationId: ORGANIZATION_ID,
      userId,
      role: orgRoleFor(member),
      syncId: 0,
      createdAt,
    });
  }

  if (fallbackUserId === '') {
    const first = rows.users[0];
    if (first === undefined) throw new Error('The export contains no members.');
    fallbackUserId = first.id;
  }
  return { byPlaneId, fallbackUserId };
}

async function writeRows(rows: ImportRows): Promise<void> {
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
  await insertAll(schema.issue, rows.issues);
  await insertAll(schema.issueLabel, rows.issueLabels);
  await insertAll(schema.comment, rows.comments);
  await insertAll(schema.docCollection, rows.collections);
  await insertAll(schema.doc, rows.docs);
}

async function main(): Promise<void> {
  const source = readPlaneExport(INPUT);
  console.info(
    `Reading ${source.projects.length} projects and ${source.members.length} members from ${INPUT}`,
  );

  if (!values.keep) {
    console.info('Resetting the database');
    await reset();
  }

  const now = new Date();
  const floor = source.projects.reduce<Date>((oldest, entry) => {
    const created = new Date(entry.project.created_at);
    return !Number.isNaN(created.getTime()) && created < oldest ? created : oldest;
  }, now);

  await db.insert(schema.organization).values({
    id: ORGANIZATION_ID,
    name: ORGANIZATION_NAME,
    slug: ORGANIZATION_SLUG,
    logo: null,
    allowedEmailDomains: ['noveum.ai'],
    createdAt: floor,
  });

  const rows = emptyRows();
  const { byPlaneId, fallbackUserId } = buildUsers(source.members, floor, rows);

  const context: BuildContext = {
    organizationId: ORGANIZATION_ID,
    userIdByPlaneId: byPlaneId,
    fallbackUserId,
    teamKeys: new Set<string>(),
    projectSlugs: new Set<string>(),
    now,
    floor,
  };

  let skippedDrafts = 0;
  for (const entry of source.projects) {
    const outcome = buildProject(entry, context, rows);
    skippedDrafts += outcome.skippedDrafts;
    console.info(`${entry.project.identifier}: ${entry.issues.length} work items read`);
  }

  buildDocs(source.workspacePages, 'Workspace', null, floor, context, rows);

  await writeRows(rows);

  console.info(countRows(rows));
  if (skippedDrafts > 0) console.info(`Skipped ${skippedDrafts} draft work items`);
}

await main();
await pool.end();
