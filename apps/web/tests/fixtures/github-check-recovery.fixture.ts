import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import { and, db, eq, inArray, pool, schema } from '@orbit/db';
import { linkGithubRepository } from '@orbit/services';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { type GithubRecoveryCursor, githubRecoveryPageSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import {
  bindGithubInstallation,
  replaceGithubRepositories,
} from '../../../../packages/services/src/github/installations.ts';
import { removeGithubRepositorySyncs } from '../../../../packages/services/src/github/watched.ts';

const mode = z
  .enum([
    'unauthenticated',
    'non-manager',
    'foreign-workspace',
    'scope-overrides',
    'list',
    'queued',
    'closed',
    'unavailable',
  ])
  .parse(process.argv[2]);
const database = new URL(process.env['DATABASE_URL'] ?? 'http://invalid');
if (
  !(
    ['postgres:', 'postgresql:'].includes(database.protocol) &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
    /^\/orbit_test_web(?:_[a-z0-9]+)?$/.test(database.pathname)
  )
)
  throw new Error('An explicit loopback web test database is required.');
if (process.env['NODE_ENV'] !== 'test' || process.env['BUN_OPTIONS'] !== '--no-env-file')
  throw new Error('The fixture requires test mode without environment autoload.');
for (const key of [
  'PRODUCTION_DATABASE_URL',
  'DIRECT_URL',
  'TEST_DATABASE_URL',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'RESEND_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'REDIS_URL',
  'S3_ENDPOINT',
])
  if (process.env[key] !== undefined)
    throw new Error('Provider or shared-service configuration was inherited.');
const host = database.hostname.replace(/^\[|\]$/g, '');
const port = Number(database.port || 5432);
let forbiddenNetwork = 0;
net.Socket.prototype.connect = new Proxy(net.Socket.prototype.connect, {
  apply(operation, receiver, args: unknown[]) {
    const first = args[0];
    const options = Array.isArray(first) ? first[0] : first;
    const allowed =
      (typeof first === 'number' && first === port && args[1] === host) ||
      (options !== null &&
        typeof options === 'object' &&
        'host' in options &&
        options.host === host &&
        'port' in options &&
        Number(options.port) === port);
    if (!allowed) {
      forbiddenNetwork += 1;
      throw new Error('Only the selected loopback database is permitted.');
    }
    return Reflect.apply(operation, receiver, args);
  },
});
dns.lookup = new Proxy(dns.lookup, {
  apply(operation, receiver, args: unknown[]) {
    if (args[0] !== host) {
      forbiddenNetwork += 1;
      throw new Error('External DNS is forbidden.');
    }
    return Reflect.apply(operation, receiver, args);
  },
});
globalThis.fetch = Object.assign(
  () => {
    forbiddenNetwork += 1;
    return Promise.reject(new Error('Uninjected provider requests are forbidden.'));
  },
  { preconnect: () => undefined },
);
if (
  pool.options.database !== database.pathname.slice(1) ||
  !pool.options.host.every((value) => value === host) ||
  !pool.options.port.every((value) => Number(value) === port)
)
  throw new Error('The actual driver target differs from the owned fixture.');
interface FixtureSession {
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
  readonly session: { readonly activeOrganizationId: string };
}

let session: FixtureSession | null = null;
mock.module(new URL('../../src/lib/auth/session.ts', import.meta.url).pathname, () => ({
  getSession: () => Promise.resolve(session),
  requireSession: () => Promise.resolve(session),
}));
const { GET, POST } = await import('../../src/app/api/integrations/github/check-recovery/route.ts');

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const TOKEN = 'fixture-recovery-scoped-token';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const organizations: string[] = [];
const users: string[] = [];
let sequence = 0;

async function createTarget() {
  sequence += 1;
  return await db.transaction(async (tx) => {
    const organizationId = randomUUIDv7();
    const userId = randomUUIDv7();
    const email = `${userId}@orbit.test`;
    await tx
      .insert(schema.organization)
      .values({ id: organizationId, name: 'Recovery fixture', slug: `recovery-${organizationId}` });
    await tx
      .insert(schema.user)
      .values({ id: userId, name: 'Recovery manager', email, handle: `recovery-${userId}` });
    await tx
      .insert(schema.member)
      .values({ id: randomUUIDv7(), organizationId, userId, role: 'admin' });
    const installationId = String(Date.now() * 100 + sequence);
    const installation = await bindGithubInstallation(tx, {
      organizationId,
      connectedById: userId,
      account: {
        installationId,
        accountId: '500',
        accountLogin: 'fixture-owner',
        accountType: 'Organization',
        repositorySelection: 'selected',
        suspended: false,
      },
    });
    await replaceGithubRepositories(tx, {
      installation,
      repositories: [
        {
          repositoryId: '99',
          repositoryName: 'fixture-owner/old-name',
          name: 'old-name',
          ownerLogin: 'fixture-owner',
          private: true,
          archived: false,
          defaultBranch: 'main',
          htmlUrl: 'https://github.com/fixture-owner/old-name',
        },
      ],
    });
    await linkGithubRepository(tx, {
      organizationId,
      repositoryId: '99',
      projectId: null,
      linkedById: userId,
    });
    const [repo] = await tx
      .select()
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.organizationId, organizationId));
    if (repo === undefined) throw new Error('Missing watched fixture');
    const reconciliationId = randomUUIDv7();
    const pullRequestId = randomUUIDv7();
    await tx.insert(schema.githubPullRequest).values({
      id: pullRequestId,
      organizationId,
      repositorySyncId: repo.id,
      repositoryId: '99',
      repositoryName: repo.repositoryName,
      number: 7,
      headSha: HEAD,
      headEpoch: 2,
      state: 'open',
      url: 'https://github.com/fixture-owner/old-name/pull/7',
    });
    await tx.insert(schema.githubCheckHeadReconciliation).values({
      id: reconciliationId,
      organizationId,
      repositorySyncId: repo.id,
      headSha: HEAD,
      status: 'failed',
      attempts: 8,
      jobVersion: 3,
      contextGeneration: 2,
      triggerKind: 'check_suite',
      triggerIdentity: 'original-generation',
      lastError: 'GitHub installation token returned HTTP 401.',
    });
    organizations.push(organizationId);
    users.push(userId);
    return {
      organizationId,
      userId,
      email,
      installationId,
      selector: {
        reconciliationId,
        pullRequestId,
        expectedJobVersion: 3,
        expectedContextGeneration: 2,
        expectedHeadEpoch: 2,
        expectedHeadSha: HEAD,
      },
    };
  });
}

type Target = Awaited<ReturnType<typeof createTarget>>;
let target: Target;
let providerCalls: string[] = [];
let installationStatus = 200;
let remoteState: 'open' | 'closed' = 'open';

function githubResponse(...args: Parameters<typeof globalThis.fetch>): Response {
  const [input, init] = args;
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, 'https://api.github.com');
  providerCalls.push(url.pathname);
  if (url.pathname.endsWith('/access_tokens')) {
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { repository_ids: [99] });
    return Response.json({ token: TOKEN }, { status: 201 });
  }
  if (url.pathname === '/installation/repositories') {
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${TOKEN}`);
    return Response.json({
      total_count: 1,
      repositories: [{ id: 99, full_name: 'fixture-owner/current-name' }],
    });
  }
  if (url.pathname === '/repos/fixture-owner/current-name/pulls/7') {
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${TOKEN}`);
    return Response.json({
      id: 7007,
      number: 7,
      state: remoteState,
      merged: false,
      draft: false,
      head: { sha: HEAD },
      base: { repo: { id: 99 } },
      updated_at: '2026-11-17T12:00:00Z',
    });
  }
  assert.equal(url.pathname, `/app/installations/${target.installationId}`);
  return installationStatus === 200
    ? Response.json({
        id: Number(target.installationId),
        app_id: 123456,
        account: { id: 500 },
        suspended_at: null,
      })
    : Response.json({ message: TOKEN }, { status: installationStatus });
}

function fakeGithub(): typeof globalThis.fetch {
  return Object.assign(
    (...args: Parameters<typeof globalThis.fetch>) => Promise.resolve(githubResponse(...args)),
    { preconnect: () => undefined },
  );
}

async function setup() {
  process.env['GITHUB_APP_ID'] = '123456';
  process.env['GITHUB_APP_PRIVATE_KEY'] = privateKey;
  target = await createTarget();
  session = {
    user: { id: target.userId, name: 'Recovery manager', email: target.email },
    session: { activeOrganizationId: target.organizationId },
  };
  providerCalls = [];
  installationStatus = 200;
  remoteState = 'open';
  globalThis.fetch = fakeGithub();
}

async function cleanup() {
  session = null;
  const ids = organizations.splice(0);
  if (ids.length > 0) {
    await removeGithubRepositorySyncs(db, inArray(schema.githubRepositorySync.organizationId, ids));
    await db.delete(schema.organization).where(inArray(schema.organization.id, ids));
  }
  const ownedUsers = users.splice(0);
  if (ownedUsers.length > 0)
    await db.delete(schema.user).where(inArray(schema.user.id, ownedUsers));
}

function listPage(cursor?: GithubRecoveryCursor): Promise<Response> {
  const url = new URL('https://orbit.local/api/integrations/github/check-recovery');
  if (cursor) url.search = new URLSearchParams(cursor).toString();
  return GET(new Request(url));
}

async function recover(body: unknown = target.selector): Promise<Response> {
  return await POST(
    new Request('https://orbit.local/api/integrations/github/check-recovery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function storedHead() {
  const [head] = await db
    .select()
    .from(schema.githubCheckHeadReconciliation)
    .where(eq(schema.githubCheckHeadReconciliation.id, target.selector.reconciliationId));
  return head;
}

async function runCase(): Promise<void> {
  if (mode === 'unauthenticated') {
    session = null;
    assert.equal((await listPage()).status, 401);
    assert.equal((await recover()).status, 401);
    assert.equal(providerCalls.length, 0);
    assert.equal((await storedHead())?.attempts, 8);
  } else if (mode === 'non-manager') {
    await db
      .update(schema.member)
      .set({ role: 'member' })
      .where(
        and(
          eq(schema.member.organizationId, target.organizationId),
          eq(schema.member.userId, target.userId),
        ),
      );
    assert.equal((await listPage()).status, 403);
    assert.equal((await recover()).status, 403);
    assert.equal(providerCalls.length, 0);
    assert.equal((await storedHead())?.attempts, 8);
  } else if (mode === 'foreign-workspace') {
    const rival = await createTarget();
    assert.equal((await recover(rival.selector)).status, 404);
    assert.equal(providerCalls.length, 0);
    assert.equal((await storedHead())?.attempts, 8);
  } else if (mode === 'scope-overrides') {
    for (const extra of [
      { organizationId: 'other-workspace' },
      { installationId: '123' },
      { freshInstallationToken: true },
    ])
      assert.equal((await recover({ ...target.selector, ...extra })).status, 422);
    assert.equal(providerCalls.length, 0);
  } else if (mode === 'list') {
    const rival = await createTarget();
    const [pull] = await db
      .select()
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.id, target.selector.pullRequestId));
    assert.ok(pull);
    const initialHead = await storedHead();
    assert.ok(initialHead);
    const extraHeads = Array.from({ length: 20 }, (_, index) => ({
      ...initialHead,
      id: randomUUIDv7(),
      headSha: (index + 1).toString(16).padStart(40, '0'),
    }));
    await db.insert(schema.githubCheckHeadReconciliation).values(extraHeads);
    const headsBySha = new Map([initialHead, ...extraHeads].map((head) => [head.headSha, head.id]));
    const others = Array.from({ length: 21 }, (_, index) => ({
      ...pull,
      id: randomUUIDv7(),
      number: pull.number + index + 1,
      headSha: extraHeads[index - 1]?.headSha ?? initialHead.headSha,
    }));
    await db.insert(schema.githubPullRequest).values(others);
    const first = githubRecoveryPageSchema.parse(await (await listPage()).json());
    assert.equal(first.candidates.length, 20);
    assert.ok(first.nextCursor);
    const second = githubRecoveryPageSchema.parse(await (await listPage(first.nextCursor)).json());
    assert.equal(second.candidates.length, 2);
    assert.equal(second.nextCursor, null);
    const candidates = [...first.candidates, ...second.candidates];
    assert.deepEqual(
      candidates.map((row) => row.selector.pullRequestId),
      [pull, ...others].map((row) => row.id).sort(),
    );
    for (const entry of candidates) {
      const expected = [pull, ...others].find((row) => row.id === entry.selector.pullRequestId);
      assert.ok(expected);
      assert.deepEqual(entry.selector, {
        ...target.selector,
        reconciliationId: headsBySha.get(expected.headSha),
        expectedHeadSha: expected.headSha,
        pullRequestId: expected.id,
      });
      assert.equal(entry.repositoryName, 'fixture-owner/old-name');
    }
    assert.equal(
      (await listPage({ ...first.nextCursor, workspace: rival.organizationId })).status,
      422,
    );
    const incomplete = new Request(
      'https://orbit.local/api/integrations/github/check-recovery?after=only',
    );
    assert.equal((await GET(incomplete)).status, 422);
    assert.equal((await storedHead())?.attempts, 8);
    await db
      .update(schema.githubPullRequest)
      .set({ headEpoch: 3 })
      .where(eq(schema.githubPullRequest.id, target.selector.pullRequestId));
    assert.deepEqual(await (await recover()).json(), { status: 'superseded' });
    await db
      .update(schema.githubPullRequest)
      .set({ state: 'closed' })
      .where(eq(schema.githubPullRequest.repositorySyncId, pull.repositorySyncId));
    assert.deepEqual(await (await listPage()).json(), {
      workspace: target.organizationId,
      candidates: [],
      nextCursor: null,
    });
    assert.equal(providerCalls.length, 0);
    assert.equal((await storedHead())?.attempts, 8);
  } else if (mode === 'queued') {
    const response = await recover();
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { status: 'queued' });
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes(privateKey), false);
    assert.equal(providerCalls.length, 4);
    assert.deepEqual(await (await recover()).json(), { status: 'already_queued' });
    assert.equal(providerCalls.length, 4);
    const head = await storedHead();
    assert.equal(head?.status, 'pending');
    assert.equal(head?.jobVersion, 4);
    assert.equal(head?.attempts, 0);
    assert.equal(head?.triggerKind, 'manual_recovery');
    assert.deepEqual(await (await listPage()).json(), {
      workspace: target.organizationId,
      candidates: [],
      nextCursor: null,
    });
    assert.equal(providerCalls.length, 4);
  } else if (mode === 'closed') {
    remoteState = 'closed';
    assert.deepEqual(await (await recover()).json(), { status: 'not_active' });
    const head = await storedHead();
    assert.equal(head?.status, 'failed');
    assert.equal(head?.jobVersion, 3);
    assert.equal(head?.attempts, 8);
  } else {
    installationStatus = 404;
    const response = await recover();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'installation_unavailable' });
    assert.equal(providerCalls.length, 1);
    const head = await storedHead();
    assert.equal(head?.status, 'failed');
    assert.equal(head?.jobVersion, 3);
    assert.equal(head?.attempts, 8);
  }
}

try {
  const [identity] = await pool.unsafe<{ name: string; role: string }[]>(
    'select current_database() as name,current_user as role',
  );
  assert.equal(identity?.name, database.pathname.slice(1));
  assert.equal(identity?.role, decodeURIComponent(database.username));
  await setup();
  await runCase();
  assert.equal(forbiddenNetwork, 0);
} finally {
  try {
    await cleanup();
  } finally {
    await pool.end({ timeout: 5 });
  }
}
console.log(JSON.stringify({ completed: true, mode }));
