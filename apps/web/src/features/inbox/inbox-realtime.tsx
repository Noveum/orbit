'use client';

import type { InboxConversationPage } from '@orbit/shared/validators';
import { ConversationInbox } from './conversation-inbox.tsx';

export interface InboxRealtimeProps {
  readonly initialPage: InboxConversationPage;
  readonly organizationId: string;
  readonly userId: string;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
}

export function InboxRealtime({
  initialPage,
  organizationId,
  userId,
  canWriteDocs,
  canPublishDocs,
}: InboxRealtimeProps) {
  return (
    <ConversationInbox
      key={`${organizationId}:${userId}`}
      initialPage={initialPage}
      organizationId={organizationId}
      userId={userId}
      canWriteDocs={canWriteDocs}
      canPublishDocs={canPublishDocs}
    />
  );
}
