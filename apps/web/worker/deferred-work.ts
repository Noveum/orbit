import { DurableObject } from 'cloudflare:workers';
import { createDatabaseScope } from '@orbit/db';
import { performDeferredWork } from '../src/lib/background/perform.ts';
import { deferredWorkSchema } from '../src/lib/background/work.ts';
import { DeferredWorkSlot } from '../src/lib/cloudflare/deferred-work-slot.ts';
import type { WorkerBindings } from './bindings.ts';

const SCHEDULE_PATH = '/schedule';

export class DeferredWorkObject extends DurableObject<WorkerBindings> {
  private slot(): DeferredWorkSlot {
    return new DeferredWorkSlot(this.ctx.storage);
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== SCHEDULE_PATH) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const work = deferredWorkSchema.safeParse(await request.json());
    if (!work.success) return Response.json({ error: 'invalid_work' }, { status: 400 });
    await this.slot().schedule(work.data);
    return Response.json({ scheduled: true }, { status: 202 });
  }

  async alarm(): Promise<void> {
    await createDatabaseScope()(() => this.slot().run(performDeferredWork));
  }
}
