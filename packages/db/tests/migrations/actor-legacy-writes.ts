import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined) throw new Error('DATABASE_URL is required.');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/^orbit_test_actor_expand(?:_[a-z0-9]+)*$/.test(databaseName)) {
  throw new Error('Legacy writer checks require an isolated orbit_test_actor_expand database.');
}
process.env['REDIS_URL'] = '';
const credentialSecret = 'actor-expand-legacy-credential-test-secret';
process.env['BETTER_AUTH_SECRET'] = credentialSecret;

const { db, eq, pool, schema, sql } = await import('../../src/index.ts');

async function runChecks(): Promise<void> {
  const [current] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  strictEqual(current?.name, databaseName);

  const [{ createUser }, { createOrganization }, { resolvePrincipal }, issues, mcp] =
    await Promise.all([
      import('../../../core/src/test-support.ts'),
      import('../../../core/src/org/organization-service.ts'),
      import('../../../core/src/org/member-service.ts'),
      import('../../../core/src/work/issue-service.ts'),
      import('../../../core/src/auth/mcp-token.ts'),
    ]);
  if (process.argv.includes('--existing-credential')) {
    const legacy = await import('./legacy-mcp-reader.ts');
    const token = legacy.bindLegacyMcpCredential(
      'existing-access-token',
      'expand-grant',
      credentialSecret,
    );
    const verified = await legacy.verifyLegacyMcpAccessToken(
      token,
      new Date('2026-10-04T00:00:00Z'),
    );
    strictEqual(verified.userId, 'expand-creator');
    strictEqual(verified.principal.userId, 'expand-creator');
    strictEqual(verified.organizationId, 'expand-org');
    strictEqual(verified.principal.organizationId, 'expand-org');
    strictEqual(verified.clientId, 'expand-client');
    strictEqual(verified.scopes, 'orbit.read orbit.write');
    console.info('Existing MCP credential verified through the legacy reader.');
    return;
  }
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const owner = await createUser(`Legacy owner ${suffix}`);
  const bootstrap = await createOrganization(
    owner.id,
    { name: `Legacy smoke ${suffix.slice(0, 8)}`, slug: `legacy-smoke-${suffix}` },
    { seed: true },
  );
  const principal = await resolvePrincipal(owner.id, bootstrap.organization.id);
  const starterIssues = await db
    .select()
    .from(schema.issue)
    .where(eq(schema.issue.teamId, bootstrap.team.id));
  const expansionOnly = process.argv.includes('--expansion-only');
  ok(starterIssues.length > 0);
  ok(starterIssues.some((issue) => issue.assigneeId === null));
  ok(starterIssues.some((issue) => issue.assigneeId === owner.id));
  for (const issue of starterIssues) {
    strictEqual(issue.creatorId, owner.id);
    strictEqual(issue.creatorUserId, owner.id);
    strictEqual(issue.creatorAgentId, null);
    strictEqual(issue.assigneeUserId, issue.assigneeId);
    strictEqual(issue.assigneeAgentId, null);
    strictEqual(issue.ownerUserId, expansionOnly ? null : issue.assigneeId);
  }
  if (expansionOnly) {
    console.info('Expansion-only bootstrap preserves all NULL Owners.');
    return;
  }

  const assignee = await createUser(`Legacy assignee ${suffix}`);
  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    organizationId: bootstrap.organization.id,
    userId: assignee.id,
    role: 'member',
  });
  await db.insert(schema.teamMember).values({
    id: crypto.randomUUID(),
    teamId: bootstrap.team.id,
    userId: assignee.id,
  });

  const created = await issues.createIssue(principal, {
    teamId: bootstrap.team.id,
    title: 'Legacy default assignment',
  });
  deepStrictEqual(
    [created.issue.creatorId, created.issue.creatorUserId, created.issue.creatorAgentId],
    [owner.id, owner.id, null],
  );
  deepStrictEqual(
    [created.issue.assigneeId, created.issue.assigneeUserId, created.issue.ownerUserId],
    [owner.id, owner.id, owner.id],
  );

  const unassigned = await issues.createIssue(principal, {
    teamId: bootstrap.team.id,
    title: 'Legacy explicit unassignment',
    assigneeId: null,
  });
  deepStrictEqual(
    [unassigned.issue.assigneeId, unassigned.issue.assigneeUserId, unassigned.issue.ownerUserId],
    [null, null, null],
  );
  const assigned = await issues.updateIssue(principal, unassigned.issue.id, {
    assigneeId: assignee.id,
  });
  deepStrictEqual(
    [assigned.issue.assigneeId, assigned.issue.assigneeUserId, assigned.issue.ownerUserId],
    [assignee.id, assignee.id, assignee.id],
  );
  const reassigned = await issues.updateIssue(principal, unassigned.issue.id, {
    assigneeId: owner.id,
  });
  deepStrictEqual(
    [reassigned.issue.assigneeId, reassigned.issue.assigneeUserId, reassigned.issue.ownerUserId],
    [owner.id, owner.id, assignee.id],
  );
  const cleared = await issues.updateIssue(principal, unassigned.issue.id, { assigneeId: null });
  deepStrictEqual(
    [cleared.issue.assigneeId, cleared.issue.assigneeUserId, cleared.issue.ownerUserId],
    [null, null, assignee.id],
  );
  strictEqual(cleared.issue.assigneeAgentId, null);

  const clientId = `legacy-client-${suffix}`;
  await db.insert(schema.oauthApplication).values({
    id: crypto.randomUUID(),
    name: 'Legacy client',
    clientId,
    redirectUrls: 'http://127.0.0.1:9000/callback',
    type: 'public',
    userId: owner.id,
  });
  const grantInput = {
    clientId,
    userId: owner.id,
    organizationId: bootstrap.organization.id,
    scopes: 'openid orbit.read orbit.write',
  };
  const firstGrantId = await mcp.recordMcpGrant(grantInput);
  const grantId = await mcp.recordMcpGrant(grantInput);
  ok(firstGrantId !== grantId);
  const grants = await db
    .select()
    .from(schema.mcpGrant)
    .where(eq(schema.mcpGrant.clientId, clientId));
  strictEqual(grants.length, 1);
  strictEqual(grants[0]?.id, grantId);
  strictEqual(grants[0]?.revokedAt, null);

  const accessToken = `legacy-access-${suffix}`;
  await db.insert(schema.oauthAccessToken).values({
    id: crypto.randomUUID(),
    accessToken,
    refreshToken: `legacy-refresh-${suffix}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    clientId,
    userId: owner.id,
    scopes: grantInput.scopes,
  });
  const token = mcp.bindMcpCredential(accessToken, grantId, credentialSecret);
  const verified = await mcp.verifyMcpAccessToken(token);
  strictEqual(verified.userId, owner.id);
  strictEqual(verified.organizationId, bootstrap.organization.id);
  strictEqual(verified.scopes, grantInput.scopes);
  strictEqual((await mcp.verifyMcpAccessToken(token)).clientId, clientId);
  console.info('Legacy Issue, starter, and MCP writers passed against the expanded database.');
}

try {
  await runChecks();
} finally {
  await pool.end();
}
