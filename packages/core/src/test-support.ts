import { asc, db, eq, schema, sql } from '@orbit/db';
import type { OrgRole } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { newId } from './internal.ts';
import { resolvePrincipal } from './org/member-service.ts';
import { createOrganization } from './org/organization-service.ts';

export async function resetDatabase(): Promise<void> {
  const [current] = (await db.execute<{ name: string }>(sql`select current_database() as name`))
    .rows;
  if (current === undefined || !current.name.includes('test')) {
    throw new Error(
      `resetDatabase refuses to truncate "${current?.name ?? 'unknown'}". Point DATABASE_URL at a database whose name contains "test".`,
    );
  }
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = result.rows.map((row) => `"${row.tablename}"`).join(', ');
  if (tables.length === 0) return;
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
  await db.execute(sql`select setval('sync_id_seq', 1, false)`);
}

export async function createUser(name: string): Promise<typeof schema.user.$inferSelect> {
  const id = newId();
  const handle = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${id.slice(0, 8)}`;
  const [row] = await db
    .insert(schema.user)
    .values({ id, name, email: `${handle}@orbit.test`, handle, emailVerified: true })
    .returning();
  if (row === undefined) throw new Error('Could not create the test user.');
  return row;
}

export interface Workspace {
  readonly organizationId: string;
  readonly teamId: string;
  readonly admin: Principal;
  readonly adminUser: typeof schema.user.$inferSelect;
  readonly states: (typeof schema.workflowState.$inferSelect)[];
}

export async function createWorkspace(name = 'Nova'): Promise<Workspace> {
  const adminUser = await createUser('Ada Admin');
  const bootstrap = await createOrganization(adminUser.id, {
    name,
    slug: `${name.toLowerCase()}-${newId().slice(0, 8)}`,
  });
  const admin = await resolvePrincipal(adminUser.id, bootstrap.organization.id);
  const states = await db
    .select()
    .from(schema.workflowState)
    .where(eq(schema.workflowState.teamId, bootstrap.team.id))
    .orderBy(asc(schema.workflowState.position));
  return {
    organizationId: bootstrap.organization.id,
    teamId: bootstrap.team.id,
    admin,
    adminUser,
    states,
  };
}

export async function addMember(
  workspace: Workspace,
  role: OrgRole,
  options: { name?: string; teamIds?: readonly string[] } = {},
): Promise<{ principal: Principal; user: typeof schema.user.$inferSelect }> {
  const user = await createUser(options.name ?? `${role} person`);
  await db.insert(schema.member).values({
    id: newId(),
    organizationId: workspace.organizationId,
    userId: user.id,
    role,
  });
  const teamIds = options.teamIds ?? [workspace.teamId];
  if (teamIds.length > 0) {
    await db
      .insert(schema.teamMember)
      .values(teamIds.map((teamId) => ({ id: newId(), teamId, userId: user.id })));
  }
  const principal = await resolvePrincipal(user.id, workspace.organizationId);
  return { principal, user };
}

export function stateNamed(
  workspace: Workspace,
  name: string,
): typeof schema.workflowState.$inferSelect {
  const found = workspace.states.find((state) => state.name === name);
  if (found === undefined) throw new Error(`No workflow state named ${name}.`);
  return found;
}
