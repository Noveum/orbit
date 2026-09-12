import { db, eq, schema } from '@orbit/db';
import { assertCan, type Principal } from '@orbit/shared/policy';

export async function getStandupMetadata(principal: Principal) {
  assertCan(principal, 'standup:read');
  const [states, projects] = await Promise.all([
    db
      .select({
        id: schema.workflowState.id,
        teamId: schema.workflowState.teamId,
        name: schema.workflowState.name,
        category: schema.workflowState.category,
        color: schema.workflowState.color,
        position: schema.workflowState.position,
      })
      .from(schema.workflowState)
      .where(eq(schema.workflowState.organizationId, principal.organizationId)),
    db
      .select({
        id: schema.project.id,
        slug: schema.project.slug,
        name: schema.project.name,
        status: schema.project.status,
        color: schema.project.color,
        icon: schema.project.icon,
      })
      .from(schema.project)
      .where(eq(schema.project.organizationId, principal.organizationId)),
  ]);
  return { states, projects };
}
