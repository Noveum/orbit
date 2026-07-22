'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { COMMENTS_ROOT, ISSUE_ROOT, ISSUES_ROOT } from '@/lib/query/keys.ts';
import type { Comment, Issue, IssueDetail } from '@/lib/query/schemas.ts';
import {
  applyCommentDelta,
  applyIssueDelta,
  applyIssueDetailDelta,
  applyReactionDelta,
  isSelfEcho,
} from '@/lib/query/sync.ts';

function patchIssueCaches(client: QueryClient, action: SyncAction): void {
  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUES_ROOT] })) {
    const teamId = query.queryKey[1];
    if (typeof teamId !== 'string') continue;
    const current = query.state.data as readonly Issue[] | undefined;
    if (current === undefined) continue;
    const next = applyIssueDelta(current, action, teamId);
    if (next !== current) client.setQueryData(query.queryKey, next);
  }

  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUE_ROOT] })) {
    const current = query.state.data as IssueDetail | undefined;
    if (current === undefined) continue;
    const next = applyIssueDetailDelta(current, action);
    if (next !== current) client.setQueryData(query.queryKey, next);
  }
}

function patchCommentCaches(
  client: QueryClient,
  action: SyncAction,
  apply: (comments: readonly Comment[], action: SyncAction) => readonly Comment[],
): void {
  for (const query of client.getQueryCache().findAll({ queryKey: [COMMENTS_ROOT] })) {
    const current = query.state.data as readonly Comment[] | undefined;
    if (current === undefined) continue;
    const next = apply(current, action);
    if (next !== current) client.setQueryData(query.queryKey, next);
  }
}

export interface DeltaBridgeProps {
  readonly userId: string;
  readonly organizationId: string;
  readonly teamIds: readonly string[];
}

export function DeltaBridge({ userId, organizationId, teamIds }: DeltaBridgeProps) {
  const client = useQueryClient();

  const subscribed = useMemo(
    () => [scopes.organization(organizationId), ...teamIds.map((id) => scopes.team(id))],
    [organizationId, teamIds],
  );
  useScopeSubscription(subscribed);

  const handler = useCallback(
    (actions: SyncAction[]) => {
      for (const action of actions) {
        if (isSelfEcho(action, userId)) continue;
        if (action.model === 'issue') patchIssueCaches(client, action);
        else if (action.model === 'comment') patchCommentCaches(client, action, applyCommentDelta);
        else if (action.model === 'reaction') {
          patchCommentCaches(client, action, applyReactionDelta);
        }
      }
    },
    [client, userId],
  );
  useDeltaHandler(handler);

  return null;
}
