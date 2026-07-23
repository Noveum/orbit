import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../client.ts';
import * as schema from '../schema/index.ts';
import { type PlaneExport, readPlaneExport } from './plane-source.ts';

const { values } = parseArgs({
  options: { input: { type: 'string', default: 'extras/import/plane' } },
});

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const INPUT = isAbsolute(values.input) ? values.input : resolve(REPOSITORY_ROOT, values.input);

interface Row {
  readonly label: string;
  readonly plane: number;
  readonly orbit: number;
}

function report(title: string, rows: readonly Row[]): number {
  const width = Math.max(...rows.map((row) => row.label.length), 1);
  console.info(`\n${title}`);
  for (const row of rows) {
    const mark = row.plane === row.orbit ? 'ok  ' : 'DIFF';
    console.info(
      `  ${mark} ${row.label.padEnd(width)}  plane ${String(row.plane).padStart(5)}` +
        `  orbit ${String(row.orbit).padStart(5)}`,
    );
  }
  return rows.filter((row) => row.plane !== row.orbit).length;
}

function liveIssues(source: PlaneExport) {
  return source.projects.flatMap((entry) =>
    entry.issues.filter((issue) => !issue.is_draft).map((issue) => ({ entry, issue })),
  );
}

async function compareProjects(source: PlaneExport): Promise<number> {
  const teams = await db
    .select({ id: schema.team.id, name: schema.team.name, key: schema.team.key })
    .from(schema.team);
  const teamByName = new Map(teams.map((team) => [team.name, team]));

  const counts = await db
    .select({ teamId: schema.issue.teamId, total: sql<number>`count(*)::int` })
    .from(schema.issue)
    .groupBy(schema.issue.teamId);
  const byTeam = new Map(counts.map((row) => [row.teamId, row.total]));

  return report(
    'Work items per project',
    source.projects.map((entry) => {
      const team = teamByName.get(entry.project.name);
      return {
        label: `${entry.project.name} (${team?.key ?? 'missing'})`,
        plane: entry.issues.filter((issue) => !issue.is_draft).length,
        orbit: team === undefined ? 0 : (byTeam.get(team.id) ?? 0),
      };
    }),
  );
}

async function compareAssignees(source: PlaneExport): Promise<number> {
  const users = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.user);
  const userByEmail = new Map(users.map((user) => [user.email, user]));

  const counts = await db
    .select({ assigneeId: schema.issue.assigneeId, total: sql<number>`count(*)::int` })
    .from(schema.issue)
    .groupBy(schema.issue.assigneeId);
  const byAssignee = new Map(counts.map((row) => [row.assigneeId ?? 'unassigned', row.total]));

  const planeByMember = new Map<string, number>();
  for (const { issue } of liveIssues(source)) {
    const first = issue.assignees[0];
    if (first === undefined) continue;
    planeByMember.set(first, (planeByMember.get(first) ?? 0) + 1);
  }

  return report(
    'Work items assigned, by person',
    source.members
      .filter((member) => !member.is_bot)
      .map((member) => {
        const user = userByEmail.get(member.email.toLowerCase());
        return {
          label: `${member.display_name} <${member.email}>`,
          plane: planeByMember.get(member.id) ?? 0,
          orbit: user === undefined ? 0 : (byAssignee.get(user.id) ?? 0),
        };
      })
      .sort((left, right) => right.plane - left.plane),
  );
}

async function compareStates(source: PlaneExport): Promise<number> {
  const planeTotals = new Map<string, number>();
  for (const { entry, issue } of liveIssues(source)) {
    const group = entry.states.find((state) => state.id === issue.state)?.group ?? 'unknown';
    planeTotals.set(group, (planeTotals.get(group) ?? 0) + 1);
  }

  const categories = await db
    .select({ category: schema.workflowState.category, total: sql<number>`count(*)::int` })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .groupBy(schema.workflowState.category);
  const orbitTotals = new Map(categories.map((row) => [row.category, row.total]));

  const sum = (totals: ReadonlyMap<string, number>, keys: readonly string[]): number =>
    keys.reduce((total, key) => total + (totals.get(key) ?? 0), 0);

  return report('Work item state', [
    {
      label: 'open',
      plane: sum(planeTotals, ['backlog', 'unstarted', 'started', 'triage']),
      orbit: sum(orbitTotals, ['triage', 'backlog', 'unstarted', 'started', 'review']),
    },
    {
      label: 'completed',
      plane: sum(planeTotals, ['completed']),
      orbit: sum(orbitTotals, ['completed']),
    },
    {
      label: 'cancelled',
      plane: sum(planeTotals, ['cancelled', 'canceled']),
      orbit: sum(orbitTotals, ['canceled']),
    },
  ]);
}

async function compareContent(source: PlaneExport): Promise<number> {
  const planePages =
    source.projects.reduce((total, entry) => total + entry.pages.length, 0) +
    source.workspacePages.length;
  const [docs] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.doc);
  const [comments] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.comment);
  const planeComments = source.projects.reduce(
    (total, entry) =>
      total + Object.values(entry.comments).reduce((sum, rows) => sum + rows.length, 0),
    0,
  );

  console.info(`\nComments  plane ${planeComments}  orbit ${comments?.total ?? 0}`);
  console.info('  a comment whose body is empty once html is stripped is not imported');
  return report('Documents', [{ label: 'pages', plane: planePages, orbit: docs?.total ?? 0 }]);
}

async function main(): Promise<void> {
  const source = readPlaneExport(INPUT);
  console.info(`Comparing ${INPUT} against the database`);

  const failures =
    (await compareProjects(source)) +
    (await compareAssignees(source)) +
    (await compareStates(source)) +
    (await compareContent(source));

  if (failures > 0) {
    console.error(`\n${failures} mismatches.`);
    process.exitCode = 1;
    return;
  }
  console.info('\nEvery counted total matches Plane.');
}

await main();
await pool.end();
