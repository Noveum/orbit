import { db, pool } from '@orbit/db';
import { z } from 'zod';
import { bootstrapActiveCycleMemberships } from '../../src/analytics/membership.ts';
import { completeCycle } from '../../src/work/cycle-service.ts';
import { updateIssue } from '../../src/work/issue-service.ts';

const principalSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  role: z.enum(['guest', 'contributor', 'member', 'admin']),
  teamIds: z.array(z.string()),
});

const inputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('update'),
    principal: principalSchema,
    issueId: z.string(),
    cycleId: z.string(),
  }),
  z.object({
    operation: z.literal('complete'),
    principal: principalSchema,
    cycleId: z.string(),
    occurredAt: z.coerce.date(),
  }),
  z.object({
    operation: z.literal('bootstrap'),
    occurredAt: z.coerce.date(),
  }),
]);

const encoded = Bun.argv[2];
if (encoded === undefined) throw new Error('Missing membership race input.');
const input = inputSchema.parse(JSON.parse(encoded));

let count = 1;
try {
  if (input.operation === 'update') {
    await updateIssue(input.principal, input.issueId, { cycleId: input.cycleId });
  } else if (input.operation === 'complete') {
    await completeCycle(input.principal, input.cycleId, input.occurredAt);
  } else {
    count = await db.transaction(async (tx) =>
      bootstrapActiveCycleMemberships(tx, input.occurredAt),
    );
  }
} finally {
  await pool.end();
}
console.log(JSON.stringify({ count }));
