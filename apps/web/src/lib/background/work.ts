import { z } from 'zod';

const identifier = z.string().min(1);

export const deferredWorkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pull-request-backfill'), organizationId: identifier }),
  z.object({
    kind: z.literal('pull-request-history'),
    organizationId: identifier,
    userId: identifier,
    pullRequestId: identifier,
  }),
]);

export type DeferredWork = z.infer<typeof deferredWorkSchema>;

export function deferredWorkKey(work: DeferredWork): string {
  if (work.kind === 'pull-request-backfill') return `${work.kind}:${work.organizationId}`;
  return `${work.kind}:${work.organizationId}:${work.pullRequestId}`;
}
