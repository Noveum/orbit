import { eq, schema, type Transaction } from '@orbit/db';
import { requireRow } from '../internal.ts';

export async function lockOrganization(
  executor: Transaction,
  organizationId: string,
): Promise<typeof schema.organization.$inferSelect> {
  const [organization] = await executor
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)
    .for('update');
  return requireRow(organization, 'That workspace does not exist.');
}
