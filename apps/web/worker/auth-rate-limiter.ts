import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { RateLimitTable } from '../src/lib/cloudflare/rate-limit-table.ts';
import type { WorkerBindings } from './bindings.ts';

const keySchema = z.object({ key: z.string().min(1) });

const recordSchema = keySchema.extend({
  count: z.number().int().nonnegative(),
  lastRequest: z.number().int().nonnegative(),
});

const consumeSchema = keySchema.extend({
  rule: z.object({ window: z.number().int().positive(), max: z.number().int().positive() }),
});

export class AuthRateLimiterObject extends DurableObject<WorkerBindings> {
  private table: RateLimitTable | undefined;

  private limits(): RateLimitTable {
    this.table ??= new RateLimitTable(this.ctx.storage.sql);
    return this.table;
  }

  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname;
    const body: unknown = await request.json();
    if (operation === '/consume') {
      const { key, rule } = consumeSchema.parse(body);
      return Response.json(this.limits().consume(key, rule));
    }
    if (operation === '/get') {
      return Response.json(this.limits().get(keySchema.parse(body).key));
    }
    if (operation === '/set') {
      this.limits().set(recordSchema.parse(body));
      return Response.json({ stored: true });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
}
