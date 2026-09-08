import { type Database, schema, type Transaction } from '@orbit/db';
import { and, asc, eq } from 'drizzle-orm';

export async function githubFailureDetails(
  database: Database | Transaction,
  pull: Pick<
    typeof schema.githubPullRequest.$inferSelect,
    | 'id'
    | 'organizationId'
    | 'repositorySyncId'
    | 'repositoryName'
    | 'number'
    | 'headSha'
    | 'headEpoch'
    | 'url'
  >,
) {
  const projection = schema.githubPullRequestCheckContext;
  const activity = schema.githubCheckActivity;
  const failures = await database
    .select({ payload: activity.payload })
    .from(projection)
    .innerJoin(
      activity,
      and(
        eq(activity.id, projection.latestActivityId),
        eq(activity.organizationId, projection.organizationId),
      ),
    )
    .where(
      and(
        eq(projection.organizationId, pull.organizationId),
        eq(projection.repositorySyncId, pull.repositorySyncId),
        eq(projection.pullRequestId, pull.id),
        eq(projection.headSha, pull.headSha),
        eq(projection.capturedHeadEpoch, pull.headEpoch),
        eq(projection.projectedState, 'failure'),
      ),
    )
    .orderBy(asc(projection.contextKey))
    .limit(4);
  const names = failures.slice(0, 3).map(({ payload }) => {
    const context = payload['context'];
    const name =
      typeof context === 'string'
        ? context
            .replace(/\s+/g, ' ')
            .slice(0, 80)
            .replace(/[\uD800-\uDBFF]$/u, '')
        : 'CI check';
    const conclusion = payload['conclusion'];
    if (conclusion === 'timed_out') return `${name} (timed out)`;
    if (conclusion === 'cancelled') return `${name} (cancelled)`;
    if (conclusion === 'action_required') return `${name} (action required)`;
    return name;
  });
  const failed =
    names.length === 0
      ? 'See GitHub for check details'
      : `Failed: ${names.join(', ')}${failures.length > 3 ? ', and more' : ''}`;
  let externalUrl = pull.url;
  const candidate = failures[0]?.payload['url'];
  if (typeof candidate === 'string') {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' && parsed.href.length <= 2048) externalUrl = parsed.href;
    } catch {
      externalUrl = pull.url;
    }
  }
  return {
    bodyFormat: 'plain_text' as const,
    body: `${pull.repositoryName}#${pull.number} · Commit ${pull.headSha.slice(0, 7)}\n${failed}`,
    externalUrl,
  };
}
