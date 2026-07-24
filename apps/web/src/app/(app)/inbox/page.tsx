import type { Metadata } from 'next';
import { loadInbox } from '@/features/inbox/data.ts';
import { InboxRealtime } from '@/features/inbox/inbox-realtime.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Inbox' };

const DEFAULT_REALTIME_URL = 'ws://localhost:3100';

export default async function InboxPage() {
  const context = await pageContext();
  const inbox = await loadInbox(context.principal);

  return (
    <InboxRealtime
      items={inbox.items}
      unreadCount={inbox.unreadCount}
      unreadMentions={inbox.unreadMentions}
      userId={context.principal.userId}
      organizationId={context.principal.organizationId}
      realtimeUrl={process.env['NEXT_PUBLIC_REALTIME_URL'] ?? DEFAULT_REALTIME_URL}
      token={context.sessionToken}
    />
  );
}
