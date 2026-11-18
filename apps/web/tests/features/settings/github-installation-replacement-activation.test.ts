import { describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  createReplacementFixture,
  observeReplacement,
  type ReplacementFixture,
} from './github-replacement-fixture.ts';

async function productionReplacement<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previousMode = process.env['NODE_ENV'];
  const previousActivation = process.env['ORBIT_GITHUB_INSTALLATION_REPLACEMENT_ENABLED'];
  Reflect.set(process.env, 'NODE_ENV', 'production');
  if (value === undefined) delete process.env['ORBIT_GITHUB_INSTALLATION_REPLACEMENT_ENABLED'];
  else process.env['ORBIT_GITHUB_INSTALLATION_REPLACEMENT_ENABLED'] = value;
  try {
    return await run();
  } finally {
    if (previousMode === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previousMode);
    if (previousActivation === undefined)
      delete process.env['ORBIT_GITHUB_INSTALLATION_REPLACEMENT_ENABLED'];
    else process.env['ORBIT_GITHUB_INSTALLATION_REPLACEMENT_ENABLED'] = previousActivation;
  }
}

async function activationHistory(fixture: ReplacementFixture): Promise<void> {
  const organizationId = fixture.workspace.organizationId;
  await db
    .update(schema.integration)
    .set({ config: { retainedPolicy: true }, credentials: { retainedFixture: 'opaque' } })
    .where(eq(schema.integration.id, fixture.original.integrationId));
  await db
    .update(schema.githubRepositorySync)
    .set({ enabled: false, teamId: fixture.workspace.teamId })
    .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
  const headId = randomUUIDv7();
  await db.insert(schema.githubCheckHeadReconciliation).values({
    id: headId,
    organizationId,
    repositorySyncId: fixture.watch.id,
    headSha: 'a'.repeat(40),
    status: 'failed',
    attempts: 8,
    jobVersion: 3,
    contextGeneration: 2,
    triggerKind: 'check_suite',
    triggerIdentity: 'retained-failed-head',
    lastError: 'GitHub installation token returned HTTP 401.',
  });
  await db.insert(schema.githubCheckReconciliationFetch).values({
    id: randomUUIDv7(),
    organizationId,
    repositorySyncId: fixture.watch.id,
    headReconciliationId: headId,
    headSha: 'a'.repeat(40),
    attemptNumber: 8,
    capturedJobVersion: 3,
    capturedContextGeneration: 2,
    claimToken: randomUUIDv7(),
    disposition: 'failed',
    failure: 'GitHub installation token returned HTTP 401.',
    completedAt: new Date('2026-11-01T00:00:00Z'),
  });
  await db.insert(schema.githubPullRequestReconciliation).values({
    id: randomUUIDv7(),
    organizationId,
    repositorySyncId: fixture.watch.id,
    pullRequestId: fixture.pullId,
    status: 'failed',
    attempts: 8,
    jobVersion: 4,
    capturedHeadEpoch: 3,
    conflictingHeadShas: ['a'.repeat(40)],
    conflictingProviderUpdatedAt: new Date('2026-11-01T00:00:00Z'),
    triggerIdentity: 'retained-failed-pull',
    lastError: 'GitHub installation token returned HTTP 401.',
  });
}

async function activationGraph(fixture: ReplacementFixture) {
  const organizationId = fixture.workspace.organizationId;
  return {
    integrations: await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, organizationId))
      .orderBy(schema.integration.id),
    installations: await db
      .select()
      .from(schema.githubInstallation)
      .where(eq(schema.githubInstallation.organizationId, organizationId))
      .orderBy(schema.githubInstallation.id),
    catalog: await db
      .select()
      .from(schema.githubRepository)
      .where(eq(schema.githubRepository.organizationId, organizationId))
      .orderBy(schema.githubRepository.id),
    watched: await db
      .select()
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.organizationId, organizationId))
      .orderBy(schema.githubRepositorySync.id),
    repositoryLinks: await db
      .select()
      .from(schema.githubRepositoryLink)
      .where(eq(schema.githubRepositoryLink.organizationId, organizationId))
      .orderBy(schema.githubRepositoryLink.id),
    links: await db
      .select()
      .from(schema.gitLink)
      .where(eq(schema.gitLink.organizationId, organizationId))
      .orderBy(schema.gitLink.id),
    pulls: await db
      .select()
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.organizationId, organizationId))
      .orderBy(schema.githubPullRequest.id),
    activity: await db
      .select()
      .from(schema.githubPullRequestActivity)
      .where(eq(schema.githubPullRequestActivity.organizationId, organizationId))
      .orderBy(schema.githubPullRequestActivity.id),
    heads: await db
      .select()
      .from(schema.githubCheckHeadReconciliation)
      .where(eq(schema.githubCheckHeadReconciliation.organizationId, organizationId))
      .orderBy(schema.githubCheckHeadReconciliation.id),
    fetches: await db
      .select()
      .from(schema.githubCheckReconciliationFetch)
      .where(eq(schema.githubCheckReconciliationFetch.organizationId, organizationId))
      .orderBy(schema.githubCheckReconciliationFetch.id),
    pullJobs: await db
      .select()
      .from(schema.githubPullRequestReconciliation)
      .where(eq(schema.githubPullRequestReconciliation.organizationId, organizationId))
      .orderBy(schema.githubPullRequestReconciliation.id),
  };
}

describe('replacement production activation gate', () => {
  it('defaults replacement off in production without mutating the persisted graph', async () => {
    const fixture = await createReplacementFixture();
    await activationHistory(fixture);
    const before = await activationGraph(fixture);
    for (const value of [undefined, 'false', 'TRUE', '1', '']) {
      await productionReplacement(value, async () => {
        const result = await observeReplacement(fixture.adopt());
        const after = await activationGraph(fixture);
        expect({
          rejected: !result.ok,
          graphUnchanged: JSON.stringify(after) === JSON.stringify(before),
          installationCountUnchanged: after.installations.length === before.installations.length,
          integrationCountUnchanged: after.integrations.length === before.integrations.length,
        }).toEqual({
          rejected: true,
          graphUnchanged: true,
          installationCountUnchanged: true,
          integrationCountUnchanged: true,
        });
        if (!result.ok)
          expect(result.error).toMatchObject({
            code: 'conflict',
            status: 409,
            details: { reason: 'github_replacement_disabled' },
          });
      });
    }
  });

  it('allows explicitly enabled production replacement', async () => {
    const fixture = await createReplacementFixture();
    await productionReplacement('true', async () => {
      const replacement = await fixture.adopt();
      expect(replacement.id).toBe(fixture.original.id);
      expect(replacement.integrationId).toBe(fixture.original.integrationId);
      expect(replacement.installationId).toBe(fixture.newId);
    });
  });

  it('keeps first and current installation connects available with replacement off', async () => {
    await productionReplacement(undefined, async () => {
      const fixture = await createReplacementFixture();
      const connected = await fixture.connect(fixture.oldId);
      expect(connected.id).toBe(fixture.original.id);
      expect(connected.integrationId).toBe(fixture.original.integrationId);
      expect(connected.installationId).toBe(fixture.oldId);
      const graph = await activationGraph(fixture);
      expect(graph.installations).toHaveLength(1);
      expect(graph.integrations).toHaveLength(1);
    });
  });
});
