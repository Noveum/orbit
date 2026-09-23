import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';
import { applyCatchup } from '../../src/apply-catchup.ts';
import { releaseDatabase } from '../../src/migration-release.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_agent_actor_migrations', currentLane());
const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const LEGACY_MIGRATION = '0016_secure_slack_team';

function urlFor(database: string): string {
  const url = new URL(BASE);
  url.pathname = `/${database}`;
  return url.toString();
}

async function run<T>(url: string, work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

async function legacyMigrations(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-agent-actor-'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const entries = journal.entries.filter((entry) => entry.tag <= LEGACY_MIGRATION);
  await cp(join(MIGRATIONS, 'meta'), join(directory, 'meta'), { recursive: true });
  await writeFile(
    join(directory, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  );
  await Promise.all(
    entries.map(async ({ tag }) => {
      await cp(join(MIGRATIONS, `${tag}.sql`), join(directory, `${tag}.sql`));
    }),
  );
  return directory;
}

async function seedLegacyData(): Promise<void> {
  await run(urlFor(SCRATCH), async (sql) => {
    await sql`
      insert into "user" (id, name, email, handle)
      values ('agent-owner', 'Agent Owner', 'agent-owner@example.com', 'agent-owner')
    `;
    await sql`
      insert into organization (id, name, slug)
      values ('agent-org', 'Agent workspace', 'agent-workspace')
    `;
    await sql`
      insert into oauth_application (id, name, client_id, redirect_urls, type)
      values ('legacy-client', 'Legacy client', 'legacy-client-id', 'https://example.com/callback', 'web')
    `;
    await sql`
      insert into mcp_grant (id, client_id, user_id, organization_id, scopes)
      values ('legacy-grant', 'legacy-client-id', 'agent-owner', 'agent-org', 'openid orbit.read')
    `;
    await sql`
      insert into oauth_access_token
        (id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, client_id, user_id, scopes)
      values
        ('legacy-token', 'legacy-access', 'legacy-refresh', now() + interval '1 hour', now() + interval '1 day', 'legacy-client-id', 'agent-owner', 'openid orbit.read')
    `;
    await sql`
      insert into member (id, organization_id, user_id, role)
      values ('agent-member', 'agent-org', 'agent-owner', 'admin')
    `;
    await sql`
      insert into team (id, organization_id, name, key)
      values ('agent-team', 'agent-org', 'Agent team', 'AGENT')
    `;
    await sql`
      insert into workflow_state (id, organization_id, team_id, name, category, color)
      values ('agent-state', 'agent-org', 'agent-team', 'Todo', 'backlog', '#000000')
    `;
    await sql`
      insert into issue
        (id, organization_id, team_id, number, identifier, title, state_id, creator_id, assignee_id)
      values
        ('assigned-issue', 'agent-org', 'agent-team', 1, 'AGENT-1', 'Assigned', 'agent-state', 'agent-owner', 'agent-owner'),
        ('unassigned-issue', 'agent-org', 'agent-team', 2, 'AGENT-2', 'Unassigned', 'agent-state', 'agent-owner', null)
    `;
    await sql`
      insert into issue_activity
        (id, organization_id, issue_id, actor_type, actor_id, actor_name, field)
      values ('legacy-activity', 'agent-org', 'assigned-issue', 'user', 'agent-owner', 'Agent Owner', 'title')
    `;
    await sql`
      insert into audit_log
        (id, organization_id, actor_type, actor_id, actor_name, action, entity_type, entity_id)
      values ('legacy-audit', 'agent-org', 'user', 'agent-owner', 'Agent Owner', 'issue.updated', 'issue', 'assigned-issue')
    `;
    await sql`
      insert into notification
        (id, organization_id, user_id, type, actor_type, actor_id, actor_name, entity_type, entity_id, title, url)
      values ('legacy-notification', 'agent-org', 'agent-owner', 'issue', 'user', 'agent-owner', 'Agent Owner', 'issue', 'assigned-issue', 'Assigned', '/issue/AGENT-1')
    `;
  });
}

describe('agent actor migration', () => {
  let legacyDirectory = '';

  beforeAll(async () => {
    legacyDirectory = await legacyMigrations();
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create extension if not exists pg_trgm`;
      await migrate(drizzle({ client: sql }), { migrationsFolder: legacyDirectory });
    });
    await seedLegacyData();
    await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([
      run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`)),
      legacyDirectory.length === 0 ? Promise.resolve() : rm(legacyDirectory, { recursive: true }),
    ]);
  }, 30_000);

  it('backfills Human Issue actors, owners, and attribution without changing legacy fields', async () => {
    const [assigned] = await run(
      urlFor(SCRATCH),
      (sql) => sql<
        {
          creator_id: string;
          creator_user_id: string | null;
          creator_agent_id: string | null;
          assignee_id: string | null;
          assignee_user_id: string | null;
          assignee_agent_id: string | null;
          owner_user_id: string | null;
        }[]
      >`
        select creator_id, creator_user_id, creator_agent_id, assignee_id, assignee_user_id,
          assignee_agent_id, owner_user_id
        from issue where id = 'assigned-issue'
      `,
    );
    const [unassigned] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ owner_user_id: string | null }[]>`
        select owner_user_id from issue where id = 'unassigned-issue'
      `,
    );
    const [activity] = await run(
      urlFor(SCRATCH),
      (sql) => sql<
        {
          principal_user_id: string | null;
          principal_name: string | null;
          grant_id: string | null;
        }[]
      >`
        select principal_user_id, principal_name, grant_id from issue_activity where id = 'legacy-activity'
      `,
    );
    const [audit] = await run(
      urlFor(SCRATCH),
      (sql) => sql<
        {
          principal_user_id: string | null;
          principal_name: string | null;
          grant_id: string | null;
        }[]
      >`
        select principal_user_id, principal_name, grant_id from audit_log where id = 'legacy-audit'
      `,
    );
    const [notification] = await run(
      urlFor(SCRATCH),
      (sql) => sql<
        {
          principal_user_id: string | null;
          principal_name: string | null;
          grant_id: string | null;
        }[]
      >`
        select principal_user_id, principal_name, grant_id from notification where id = 'legacy-notification'
      `,
    );

    expect(assigned).toEqual({
      creator_id: 'agent-owner',
      creator_user_id: 'agent-owner',
      creator_agent_id: null,
      assignee_id: 'agent-owner',
      assignee_user_id: 'agent-owner',
      assignee_agent_id: null,
      owner_user_id: 'agent-owner',
    });
    expect(unassigned?.owner_user_id).toBeNull();
    expect(activity).toEqual({
      principal_user_id: 'agent-owner',
      principal_name: 'Agent Owner',
      grant_id: null,
    });
    expect(audit).toEqual(activity);
    expect(notification).toEqual(activity);
  });

  it('installs issue actor checks, workspace bindings, and the active-grant uniqueness rule', async () => {
    const constraints = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ conname: string; definition: string }[]>`
        select conname, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conrelid in ('issue'::regclass, 'agent_identity'::regclass)
        order by conname
      `,
    );
    const names = new Map(constraints.map((row) => [row.conname, row.definition]));
    const indexes = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'mcp_grant_active_agent_unique',
            'issue_assignee_agent_idx',
            'issue_owner_user_idx',
            'agent_identity_org_owner_idx',
            'oauth_access_token_mcp_grant_idx'
          )
        order by indexname
      `,
    );

    expect(names.get('issue_creator_actor_check')).toContain('creator_user_id IS NOT NULL');
    expect(names.get('issue_assignee_actor_check')).toContain('assignee_agent_id IS NULL');
    expect(names.get('issue_agent_assignee_owner_check')).toContain('owner_user_id IS NOT NULL');
    expect(names.get('issue_organization_creator_agent_fk')).toContain(
      'FOREIGN KEY (organization_id, creator_agent_id)',
    );
    expect(names.get('issue_organization_assignee_agent_fk')).toContain(
      'FOREIGN KEY (organization_id, assignee_agent_id)',
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'agent_identity_org_owner_idx',
      'issue_assignee_agent_idx',
      'issue_owner_user_idx',
      'mcp_grant_active_agent_unique',
      'oauth_access_token_mcp_grant_idx',
    ]);
    expect(
      indexes.find((row) => row.indexname === 'mcp_grant_active_agent_unique')?.indexdef,
    ).toContain('WHERE ((revoked_at IS NULL) AND (agent_identity_id IS NOT NULL))');
    const [oldUnique] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ exists: boolean }[]>`
        select exists (
          select 1 from pg_class where relname = 'mcp_grant_client_user_unique'
        ) as exists
      `,
    );
    expect(oldUnique?.exists).toBe(false);
  });

  it('releases the complete migration chain into a fresh database', async () => {
    const fresh = `${SCRATCH}_fresh`;
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${fresh}"`);
      await sql.unsafe(`create database "${fresh}"`);
    });
    try {
      const result = await releaseDatabase(urlFor(fresh), MIGRATIONS);
      expect(result.mode).toBe('migrated');
      expect(result.applied).toBe(result.total);
    } finally {
      await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database "${fresh}"`));
    }
  });

  it('freezes legacy unbound grants and removes their unbound credentials', async () => {
    const [grant] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ revoked_at: Date | null; revoke_reason: string | null }[]>`
        select revoked_at, revoke_reason from mcp_grant where id = 'legacy-grant'
      `,
    );
    const [token] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ total: string }[]>`
        select count(*)::text as total from oauth_access_token where id = 'legacy-token'
      `,
    );
    expect(grant?.revoked_at).toBeInstanceOf(Date);
    expect(grant?.revoke_reason).toBe('agent_identity_required');
    expect(token?.total).toBe('0');
  });

  it('finishes catchup for unassigned issues and deleted human actors', async () => {
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into issue_activity
          (id, organization_id, issue_id, actor_type, actor_id, actor_name, field)
        values (
          'former-activity', 'agent-org', 'unassigned-issue', 'user',
          'former-user', 'Former user', 'title'
        )
      `;
      await sql`
        insert into audit_log
          (id, organization_id, actor_type, actor_id, actor_name, action, entity_type, entity_id)
        values (
          'former-audit', 'agent-org', 'user', 'former-user', 'Former user',
          'issue.updated', 'issue', 'unassigned-issue'
        )
      `;
      await sql`
        insert into notification
          (id, organization_id, user_id, type, actor_type, actor_id, actor_name,
           entity_type, entity_id, title, url)
        values (
          'former-notification', 'agent-org', 'agent-owner', 'issue', 'user',
          'former-user', 'Former user', 'issue', 'unassigned-issue', 'Former', '/issue/AGENT-2'
        )
      `;
    });

    await applyCatchup(urlFor(SCRATCH), 'agent-actors.sql');
    await applyCatchup(urlFor(SCRATCH), 'agent-actors.sql');

    const [issue] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ owner_user_id: string | null }[]>`
        select owner_user_id from issue where id = 'unassigned-issue'
      `,
    );
    const actors = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ principal_user_id: string | null; principal_name: string | null }[]>`
        select principal_user_id, principal_name
        from issue_activity
        where id = 'former-activity'
        union all
        select principal_user_id, principal_name
        from audit_log
        where id = 'former-audit'
        union all
        select principal_user_id, principal_name
        from notification
        where id = 'former-notification'
      `,
    );

    expect(issue?.owner_user_id).toBeNull();
    expect([...actors]).toEqual([
      { principal_user_id: null, principal_name: 'Former user' },
      { principal_user_id: null, principal_name: 'Former user' },
      { principal_user_id: null, principal_name: 'Former user' },
    ]);
  }, 30_000);

  it('rejects invalid actor combinations and duplicate active agent grants in PostgreSQL', async () => {
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into oauth_application (id, name, client_id, redirect_urls, type)
        values ('agent-client', 'Agent client', 'agent-client-id', 'https://example.com/callback', 'web')
      `;
      await sql`
        insert into agent_identity
          (id, organization_id, owner_user_id, owner_name_snapshot, client_id, client_name_snapshot, name)
        values ('agent-identity', 'agent-org', 'agent-owner', 'Agent Owner', 'agent-client-id', 'Agent client', 'Researcher')
      `;
    });

    await expect(
      run(
        urlFor(SCRATCH),
        (sql) => sql`
        insert into issue
          (id, organization_id, team_id, number, identifier, title, state_id, creator_id, creator_user_id)
        values ('missing-creator', 'agent-org', 'agent-team', 3, 'AGENT-3', 'Missing creator', 'agent-state', 'agent-owner', null)
      `,
      ),
    ).rejects.toThrow();
    await expect(
      run(
        urlFor(SCRATCH),
        (sql) => sql`
        insert into issue
          (id, organization_id, team_id, number, identifier, title, state_id, creator_id, creator_user_id, creator_agent_id)
        values ('two-creators', 'agent-org', 'agent-team', 4, 'AGENT-4', 'Two creators', 'agent-state', 'agent-owner', 'agent-owner', 'agent-identity')
      `,
      ),
    ).rejects.toThrow();
    await expect(
      run(
        urlFor(SCRATCH),
        (sql) => sql`
        insert into issue
          (id, organization_id, team_id, number, identifier, title, state_id, creator_id, creator_user_id, assignee_agent_id)
        values ('agent-no-owner', 'agent-org', 'agent-team', 5, 'AGENT-5', 'No owner', 'agent-state', 'agent-owner', 'agent-owner', 'agent-identity')
      `,
      ),
    ).rejects.toThrow();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into organization (id, name, slug)
        values ('other-org', 'Other workspace', 'other-workspace')
      `;
      await sql`
        insert into agent_identity
          (id, organization_id, owner_user_id, owner_name_snapshot, client_id, client_name_snapshot, name)
        values ('other-agent', 'other-org', 'agent-owner', 'Agent Owner', 'agent-client-id', 'Agent client', 'Other researcher')
      `;
    });
    await expect(
      run(
        urlFor(SCRATCH),
        (sql) => sql`
          insert into issue
            (id, organization_id, team_id, number, identifier, title, state_id, creator_id, creator_agent_id)
          values ('foreign-agent', 'agent-org', 'agent-team', 6, 'AGENT-6', 'Foreign agent', 'agent-state', 'agent-owner', 'other-agent')
        `,
      ),
    ).rejects.toThrow();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into mcp_grant
          (id, client_id, user_id, organization_id, agent_identity_id, principal_name_snapshot, scopes)
        values ('agent-grant-1', 'agent-client-id', 'agent-owner', 'agent-org', 'agent-identity', 'Agent Owner', 'orbit.read')
      `;
    });
    await expect(
      run(
        urlFor(SCRATCH),
        (sql) => sql`
        insert into mcp_grant
          (id, client_id, user_id, organization_id, agent_identity_id, principal_name_snapshot, scopes)
        values ('agent-grant-2', 'agent-client-id', 'agent-owner', 'agent-org', 'agent-identity', 'Agent Owner', 'orbit.read')
      `,
      ),
    ).rejects.toThrow();
  });
});
