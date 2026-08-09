import { and, db, gte, schema, sql } from '@orbit/db';
import { assertCan } from '@orbit/shared/policy';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { webVitalSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import { apiContext, handleRoute } from '@/lib/api/handler.ts';

const MAX_PER_REQUEST = 20;

const reportSchema = z.object({ vitals: z.array(webVitalSchema).min(1).max(MAX_PER_REQUEST) });

const windowSchema = z.coerce.number().int().min(1).max(30).catch(7);

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { vitals } = reportSchema.parse(await request.json());

    await db.insert(schema.webVital).values(
      vitals.map((vital) => ({
        id: randomUUIDv7(),
        organizationId: principal.organizationId,
        userId: principal.userId,
        route: vital.route,
        metric: vital.metric,
        value: vital.value,
        rating: vital.rating,
        navigationType: vital.navigationType,
        interactionType: vital.interactionType ?? null,
        target: vital.target ?? null,
        parts: vital.parts ?? null,
      })),
    );

    return { recorded: vitals.length };
  });
}

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'org:manage');

    const days = windowSchema.parse(new URL(request.url).searchParams.get('days'));
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);

    const rows = await db
      .select({
        route: schema.webVital.route,
        metric: schema.webVital.metric,
        interactionType: schema.webVital.interactionType,
        samples: sql<number>`count(*)::int`,
        p75: sql<number>`percentile_cont(0.75) within group (order by ${schema.webVital.value})`,
        worst: sql<number>`max(${schema.webVital.value})`,
      })
      .from(schema.webVital)
      .where(
        and(
          sql`${schema.webVital.organizationId} = ${principal.organizationId}`,
          gte(schema.webVital.createdAt, since),
        ),
      )
      .groupBy(schema.webVital.route, schema.webVital.metric, schema.webVital.interactionType)
      .orderBy(sql`percentile_cont(0.75) within group (order by ${schema.webVital.value}) desc`)
      .limit(200);

    return { days, rows };
  });
}
