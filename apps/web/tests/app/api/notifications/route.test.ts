import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';
import { mockSession } from '../../../../tests-support.ts';

let workspace: Workspace;

interface Signed {
  user: { id: string; name: string; email: string };
  session: { activeOrganizationId: string };
}

const signedIn: { value: Signed | null } = { value: null };

mockSession(() => signedIn.value);

const notifications = await import('../../../../src/app/api/notifications/route.ts');

const pageSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      url: z.string(),
      read: z.boolean(),
      snoozedUntil: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

function asUser(userId: string): void {
  signedIn.value = {
    user: { id: userId, name: 'Reader', email: `${userId}@orbit.test` },
    session: { activeOrganizationId: workspace.organizationId },
  };
}

async function seed(count: number): Promise<void> {
  await db.insert(schema.notification).values(
    Array.from({ length: count }, (_, index) => ({
      id: randomUUIDv7(),
      organizationId: workspace.organizationId,
      userId: workspace.admin.userId,
      type: 'comment_created',
      actorType: 'user' as const,
      actorId: workspace.admin.userId,
      actorName: 'Someone',
      entityType: 'issue',
      entityId: `issue_${index}`,
      title: `Notification ${String(index).padStart(3, '0')}`,
      body: '',
      url: `/issue/ENG-${index}`,
      readAt: null,
      snoozedUntil: null,
      deliveredChannels: ['inbox'],
      syncId: 0,
      createdAt: new Date(),
    })),
  );
}

async function get(url: string): Promise<Response> {
  return await notifications.GET(new Request(url));
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

beforeEach(async () => {
  await db.delete(schema.notification);
  asUser(workspace.admin.userId);
});

describe('GET /api/notifications', () => {
  it('hands back a page and the cursor that follows it', async () => {
    await seed(60);

    const page = pageSchema.parse(await (await get('http://orbit.test/api/notifications')).json());

    expect(page.notifications).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  it('says there is nothing after the last page', async () => {
    await seed(3);

    const page = pageSchema.parse(await (await get('http://orbit.test/api/notifications')).json());

    expect(page.notifications).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('picks up where the cursor left off, without repeating a row', async () => {
    await seed(60);

    const first = pageSchema.parse(await (await get('http://orbit.test/api/notifications')).json());
    const second = pageSchema.parse(
      await (
        await get(
          `http://orbit.test/api/notifications?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        )
      ).json(),
    );

    expect(second.notifications).toHaveLength(10);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.notifications, ...second.notifications].map((row) => row.id);
    expect(new Set(ids).size).toBe(60);
  });

  it('refuses to hand out more than a page however large the ask', async () => {
    await seed(60);

    const page = pageSchema.parse(
      await (await get('http://orbit.test/api/notifications?limit=200')).json(),
    );

    expect(page.notifications).toHaveLength(50);
  });

  it('honours a smaller limit', async () => {
    await seed(10);

    const page = pageSchema.parse(
      await (await get('http://orbit.test/api/notifications?limit=4')).json(),
    );

    expect(page.notifications).toHaveLength(4);
    expect(page.nextCursor).not.toBeNull();
  });

  it('turns a row into what the inbox reads, not the raw record', async () => {
    await seed(1);

    const page = pageSchema.parse(await (await get('http://orbit.test/api/notifications')).json());
    const row = page.notifications[0];

    expect(row?.read).toBe(false);
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row?.url).toContain('/issue/');
  });

  it('turns away a reader with no session', async () => {
    await seed(1);
    signedIn.value = null;

    expect((await get('http://orbit.test/api/notifications')).status).toBe(401);
  });
});
