import { db } from '@orbit/db';
import { listInbox } from '@orbit/services/notifications';
import { paginationSchema } from '@orbit/shared/validators';
import { INBOX_PAGE_SIZE, toInboxItem } from '@/features/inbox/data.ts';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = paginationSchema.parse(searchParamsOf(request));
    const page = await listInbox(db, {
      userId: principal.userId,
      organizationId: principal.organizationId,
      limit: Math.min(query.limit, INBOX_PAGE_SIZE),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });

    return { notifications: page.items.map(toInboxItem), nextCursor: page.nextCursor };
  });
}
