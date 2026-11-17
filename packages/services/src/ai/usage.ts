import { count, db, desc, eq, schema, sql } from '@orbit/db';
import type { AiUsageRecord, AiUsageSummary } from '@orbit/shared/validators';

export async function loadAiUsage(organizationId: string): Promise<AiUsageSummary> {
  const [summary] = await db
    .select({
      totalCalls: count(),
      promptTokens: sql<number>`coalesce(sum(${schema.aiUsage.promptTokens}), 0)::double precision`,
      completionTokens: sql<number>`coalesce(sum(${schema.aiUsage.completionTokens}), 0)::double precision`,
      totalTokens: sql<number>`coalesce(sum(${schema.aiUsage.totalTokens}), 0)::double precision`,
    })
    .from(schema.aiUsage)
    .where(eq(schema.aiUsage.organizationId, organizationId));

  return {
    totalCalls: summary?.totalCalls ?? 0,
    promptTokens: summary?.promptTokens ?? 0,
    completionTokens: summary?.completionTokens ?? 0,
    totalTokens: summary?.totalTokens ?? 0,
  };
}

export async function loadRecentAiUsage(
  organizationId: string,
  limit = 20,
): Promise<readonly AiUsageRecord[]> {
  const rows = await db
    .select({
      id: schema.aiUsage.id,
      model: schema.aiUsage.model,
      provider: schema.aiUsage.provider,
      promptTokens: schema.aiUsage.promptTokens,
      completionTokens: schema.aiUsage.completionTokens,
      totalTokens: schema.aiUsage.totalTokens,
      createdAt: schema.aiUsage.createdAt,
    })
    .from(schema.aiUsage)
    .where(eq(schema.aiUsage.organizationId, organizationId))
    .orderBy(desc(schema.aiUsage.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    model: row.model,
    provider: row.provider,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    createdAt: row.createdAt.toISOString(),
  }));
}
