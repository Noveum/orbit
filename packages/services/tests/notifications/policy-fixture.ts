import { schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import type { TestTransaction } from '../../src/test-database.ts';

export async function seedReadableNotificationIssues(
  tx: TestTransaction,
  organizationId: string,
  creatorId: string,
  userIds: readonly string[],
  issueIds: readonly string[],
) {
  const teamId = randomUUIDv7();
  const stateId = randomUUIDv7();
  await tx
    .insert(schema.member)
    .values(
      userIds.map((userId) => ({ id: randomUUIDv7(), organizationId, userId, role: 'admin' })),
    );
  await tx
    .insert(schema.team)
    .values({ id: teamId, organizationId, name: 'Notifications', key: 'NOT' });
  await tx.insert(schema.workflowState).values({
    id: stateId,
    organizationId,
    teamId,
    name: 'Open',
    category: 'unstarted',
    color: '#000000',
  });
  await tx.insert(schema.issue).values(
    issueIds.map((id, index) => ({
      id,
      organizationId,
      teamId,
      stateId,
      creatorId,
      number: index + 1,
      identifier: `NOT-${index + 1}`,
      title: id,
    })),
  );
}
