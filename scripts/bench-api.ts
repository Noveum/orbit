import { SQL } from 'bun';

const DEFAULT_DATABASE_URL = 'postgres://orbit:orbit@localhost:5434/orbit_bench';
const DEFAULT_BASE_URL = 'http://localhost:3456';
const DEFAULT_EMAIL = 'pulkit@noveum.ai';
const ISSUES_PER_TEAM = 2000;
const EXTRA_TEAM_KEYS = ['OPS', 'SUP', 'FIN', 'LEG', 'SEC', 'DAT', 'PLT'];
const CYCLES_PER_TEAM = 12;
const DOC_COUNT = 500;
const COMMENT_COUNT = 500;
const ACTIVITY_COUNT = 300;
const SUB_ISSUE_COUNT = 40;
const DESCRIPTION_FILLER =
  'The keyset pager exists so a list can paint from one round trip. This paragraph is here to give the row a realistic body so the measured payload reflects production shapes rather than an empty seed. ';
const SAMPLES = 12;
const WARMUPS = 3;

function arrayLiteral(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
}

function databaseUrl(): string {
  const configured = process.env['BENCH_DATABASE_URL'] ?? DEFAULT_DATABASE_URL;
  const name = new URL(configured).pathname.replace(/^\//, '');
  if (!name.includes('bench')) {
    throw new Error(
      `Refusing to seed "${name}". The benchmark database name must contain "bench".`,
    );
  }
  return configured;
}

async function seed(): Promise<void> {
  const sql = new SQL(databaseUrl());

  const [creator] = await sql`select id from "user" order by email limit 1`;
  const [organization] = await sql`select id from organization limit 1`;
  if (creator === undefined || organization === undefined) {
    throw new Error('Seed the demo workspace first: DATABASE_URL=<bench> bun run db:seed');
  }
  const assignees = await sql`select id from "user" order by email`;
  const [template] = await sql`select id from team order by key limit 1`;
  if (template === undefined) throw new Error('The benchmark database has no team to clone.');

  for (const key of EXTRA_TEAM_KEYS) {
    const teamId = `bench_team_${key}`;
    await sql`
      insert into team (id, organization_id, name, key)
      values (${teamId}, ${organization.id}, ${`Bench ${key}`}, ${key})
      on conflict do nothing
    `;
    await sql`
      insert into workflow_state (id, organization_id, team_id, name, category, color, position)
      select ${teamId} || '_state_' || position, ${organization.id}, ${teamId}, name, category, color, position
      from workflow_state where team_id = ${template.id}
      on conflict do nothing
    `;
    await sql`
      insert into cycle (id, organization_id, team_id, number, name, starts_at, ends_at)
      select
        ${teamId} || '_cycle_' || n,
        ${organization.id},
        ${teamId},
        n,
        'Cycle ' || n,
        now() - ((${CYCLES_PER_TEAM} - n) * 14 || ' days')::interval,
        now() - ((${CYCLES_PER_TEAM} - n - 1) * 14 || ' days')::interval
      from generate_series(1, ${CYCLES_PER_TEAM}) as n
      on conflict do nothing
    `;
    await sql`
      insert into team_member (id, team_id, user_id)
      select ${teamId} || '_' || id, ${teamId}, id from "user"
      on conflict do nothing
    `;
  }

  const teams = await sql`select id, key, issue_counter from team order by key`;

  for (const team of teams) {
    const states =
      await sql`select id from workflow_state where team_id = ${team.id} order by position`;
    if (states.length === 0) continue;
    const stateIds = arrayLiteral(states.map((row: { id: string }) => row.id));
    const assigneeIds = arrayLiteral(assignees.map((row: { id: string }) => row.id));
    const start = Number(team.issue_counter);

    await sql`
      insert into issue (
        id, organization_id, team_id, number, identifier, title, description,
        state_id, priority, creator_id, assignee_id, sort_order, state_entered_at,
        sync_id, created_at, updated_at
      )
      select
        'bench_' || ${team.key} || '_' || n,
        ${organization.id},
        ${team.id},
        ${start} + n,
        ${team.key} || '-' || (${start} + n),
        'Bench issue ' || n || ' for ' || ${team.key},
        repeat(${DESCRIPTION_FILLER}, 3),
        (${stateIds}::text[])[1 + (n % ${states.length})],
        n % 5,
        ${creator.id},
        (${assigneeIds}::text[])[1 + (n % ${assignees.length})],
        n * 1024,
        now(),
        n,
        now() - (n || ' minutes')::interval,
        now() - (n || ' minutes')::interval
      from generate_series(1, ${ISSUES_PER_TEAM}) as n
      on conflict do nothing
    `;
    await sql`update team set issue_counter = ${start + ISSUES_PER_TEAM} where id = ${team.id}`;
  }

  await sql`
    insert into doc (id, organization_id, title, content, author_id, sync_id, created_at, updated_at)
    select
      'bench_doc_' || n,
      ${organization.id},
      'Bench doc ' || n,
      repeat(${DESCRIPTION_FILLER}, 12),
      ${creator.id},
      n,
      now(),
      now()
    from generate_series(1, ${DOC_COUNT}) as n
    on conflict do nothing
  `;

  for (const team of teams) {
    const threadId = `bench_${team.key}_1`;
    await sql`
      insert into issue_activity (id, organization_id, issue_id, actor_id, actor_name, field, from_value, to_value, sync_id, created_at)
      select
        'bench_activity_' || ${team.key} || '_' || n,
        ${organization.id},
        ${threadId},
        ${creator.id},
        'Bench Actor',
        'priority',
        to_jsonb(n % 5),
        to_jsonb((n + 1) % 5),
        n,
        now() - (n || ' minutes')::interval
      from generate_series(1, ${ACTIVITY_COUNT}) as n
      where exists (select 1 from issue where id = ${threadId})
      on conflict do nothing
    `;
    await sql`
      update issue set parent_id = ${threadId}
      where id like ${`bench_${team.key}_%`}
        and parent_id is null
        and id <> ${threadId}
        and split_part(id, '_', 3)::int <= ${SUB_ISSUE_COUNT + 1}
    `;
    await sql`
      insert into comment (id, organization_id, issue_id, author_id, body, sync_id, created_at, updated_at)
      select
        'bench_comment_' || ${team.key} || '_' || n,
        ${organization.id},
        ${threadId},
        ${creator.id},
        '**Bench comment ' || n || '**' || chr(10) || chr(10) || ${DESCRIPTION_FILLER},
        n,
        now() - (n || ' minutes')::interval,
        now() - (n || ' minutes')::interval
      from generate_series(1, ${COMMENT_COUNT}) as n
      where exists (select 1 from issue where id = ${threadId})
      on conflict do nothing
    `;
  }

  const [{ total }] = await sql`select count(*)::int as total from issue`;
  console.log(`Seeded. ${total} issues, ${DOC_COUNT} docs, ${COMMENT_COUNT} comments.`);
  await sql.end();
}

async function signIn(baseUrl: string, email: string): Promise<string> {
  const reused = process.env['BENCH_COOKIE'];
  if (reused !== undefined && reused.length > 0) return reused;

  const response = await fetch(`${baseUrl}/api/dev/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(`Dev sign-in failed with ${response.status}: ${await response.text()}`);
  }
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((cookie) => cookie.length > 0);
  if (cookies.length === 0) throw new Error('Dev sign-in returned no session cookie.');
  return cookies.join('; ');
}

interface Measurement {
  readonly name: string;
  readonly requests: number;
  readonly bytes: number;
  readonly p50: number;
  readonly p95: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

async function measure(
  name: string,
  run: () => Promise<{ bytes: number; requests: number }>,
): Promise<Measurement> {
  for (let index = 0; index < WARMUPS; index += 1) await run();

  const timings: number[] = [];
  let bytes = 0;
  let requests = 0;
  for (let index = 0; index < SAMPLES; index += 1) {
    const started = performance.now();
    const result = await run();
    timings.push(performance.now() - started);
    bytes = result.bytes;
    requests = result.requests;
  }
  timings.sort((left, right) => left - right);
  return {
    name,
    requests,
    bytes,
    p50: percentile(timings, 0.5),
    p95: percentile(timings, 0.95),
  };
}

function fetcher(baseUrl: string, cookie: string) {
  return async (path: string): Promise<{ bytes: number; body: unknown }> => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
    const buffer = await response.arrayBuffer();
    if (!response.ok) {
      throw new Error(`GET ${path} failed with ${response.status}: ${response.statusText}`);
    }
    return { bytes: buffer.byteLength, body: JSON.parse(new TextDecoder().decode(buffer)) };
  };
}

const cursorSchema = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null;
  const next = (body as { nextCursor?: unknown }).nextCursor;
  return typeof next === 'string' ? next : null;
};

const fieldOf = (body: unknown, list: 'teams' | 'issues', field: 'id' | 'key'): string => {
  if (typeof body !== 'object' || body === null) return '';
  const rows = (body as Record<string, unknown>)[list];
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const first: unknown = rows[0];
  if (typeof first !== 'object' || first === null) return '';
  const value = (first as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
};

function table(rows: readonly Measurement[]): string {
  const header = ['endpoint', 'requests', 'KB', 'p50 ms', 'p95 ms'];
  const body = rows.map((row) => [
    row.name,
    String(row.requests),
    (row.bytes / 1024).toFixed(1),
    row.p50.toFixed(1),
    row.p95.toFixed(1),
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...body.map((line) => (line[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ');
  return [
    line(header),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...body.map(line),
  ].join('\n');
}

async function run(): Promise<void> {
  const baseUrl = process.env['BENCH_BASE_URL'] ?? DEFAULT_BASE_URL;
  const email = process.env['BENCH_EMAIL'] ?? DEFAULT_EMAIL;
  const cookie = await signIn(baseUrl, email);
  const get = fetcher(baseUrl, cookie);

  const bootstrap = await get('/api/bootstrap');
  const teamId = fieldOf(bootstrap.body, 'teams', 'id');
  const teamKey = fieldOf(bootstrap.body, 'teams', 'key');
  const listSearch = `teamId=${teamId}&limit=200&orderBy=manual`;

  const issueId = `bench_${teamKey}_1`;

  const results: Measurement[] = [];

  results.push(
    await measure('GET /api/bootstrap', async () => {
      const { bytes } = await get('/api/bootstrap');
      return { bytes, requests: 1 };
    }),
  );

  results.push(
    await measure('GET /api/issues (page 1)', async () => {
      const { bytes } = await get(`/api/issues?${listSearch}`);
      return { bytes, requests: 1 };
    }),
  );

  results.push(
    await measure('GET /api/issues (drain every page)', async () => {
      let bytes = 0;
      let requests = 0;
      let cursor: string | null = null;
      for (let page = 0; page < 40; page += 1) {
        const url: string =
          cursor === null
            ? `/api/issues?${listSearch}`
            : `/api/issues?${listSearch}&cursor=${encodeURIComponent(cursor)}`;
        const result = await get(url);
        bytes += result.bytes;
        requests += 1;
        cursor = cursorSchema(result.body);
        if (cursor === null) break;
      }
      return { bytes, requests };
    }),
  );

  results.push(
    await measure('GET /api/issues/counts', async () => {
      const { bytes } = await get(`/api/issues/counts?teamId=${teamId}`);
      return { bytes, requests: 1 };
    }).catch(() => ({
      name: 'GET /api/issues/counts',
      requests: 0,
      bytes: 0,
      p50: 0,
      p95: 0,
    })),
  );

  results.push(
    await measure('GET /api/docs', async () => {
      const { bytes } = await get('/api/docs');
      return { bytes, requests: 1 };
    }),
  );

  if (issueId.length > 0) {
    results.push(
      await measure('GET /api/issues/{id} (detail)', async () => {
        const { bytes } = await get(`/api/issues/${encodeURIComponent(issueId)}`);
        return { bytes, requests: 1 };
      }),
    );
  }

  if (issueId.length > 0) {
    results.push(
      await measure('GET /api/comments', async () => {
        const { bytes } = await get(`/api/comments?issueId=${encodeURIComponent(issueId)}`);
        return { bytes, requests: 1 };
      }),
    );
  }

  console.log(table(results));
}

const command = process.argv[2] ?? 'run';
if (command === 'seed') await seed();
else if (command === 'run') await run();
else throw new Error(`Unknown command "${command}". Use "seed" or "run".`);
