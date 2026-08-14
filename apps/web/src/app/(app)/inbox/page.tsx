import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { loadInbox } from '@/features/inbox/data.ts';
import { InboxRealtime } from '@/features/inbox/inbox-realtime.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage() {
  const context = await pageContext();
  const inbox = await loadInbox(context.principal);

  return (
    <InboxRealtime
      items={inbox.items}
      unreadCount={inbox.unreadCount}
      unreadMentions={inbox.unreadMentions}
      nextCursor={inbox.nextCursor}
      userId={context.principal.userId}
      canWriteDocs={can(context.principal, 'doc:write')}
      canPublishDocs={can(context.principal, 'doc:publish')}
    />
  );
}
