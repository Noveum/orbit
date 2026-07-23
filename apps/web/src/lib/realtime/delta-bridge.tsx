'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { clientId } from '@/lib/query/client-id.ts';
import {
  ASSIGNED_SCOPE,
  BOOTSTRAP_ROOT,
  COMMENTS_ROOT,
  DOC_ROOT,
  DOCS_ROOT,
  ISSUE_ROOT,
  ISSUES_ROOT,
} from '@/lib/query/keys.ts';
import type { Comment, Issue, IssueDetail } from '@/lib/query/schemas.ts';
import type { IssueBelongs, IssuePages } from '@/lib/query/sync.ts';
import {
  applyCommentDelta,
  applyIssueDeltaToPages,
  applyIssueDetailDelta,
  applyReactionDelta,
} from '@/lib/query/sync.ts';

const BOOTSTRAP_MODELS = new Set([
  'team',
  'label',
  'workflow_state',
  'project',
  'cycle',
  'member',
  'organization',
]);

function membershipOf(key: QueryKey): IssueBelongs | null {
  const scope = key[1];
  if (typeof scope !== 'string') return null;
  if (scope === ASSIGNED_SCOPE) {
    const userId = key[2];
    if (typeof userId !== 'string') return null;
    return (issue: Issue) => issue.assigneeId === userId;
  }
  return (issue: Issue) => issue.teamId === scope;
}

function patchIssueCaches(client: QueryClient, action: SyncAction): void {
  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUES_ROOT] })) {
    const belongs = membershipOf(query.queryKey);
    if (belongs === null) continue;
    const current = query.state.data as IssuePages | undefined;
    if (current === undefined) continue;
    const next = applyIssueDeltaToPages(current, action, belongs);
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

function isOwnEcho(action: SyncAction, tabClientId: string): boolean {
  return action.originClientId === tabClientId;
}

function applyAction(client: QueryClient, action: SyncAction): void {
  if (BOOTSTRAP_MODELS.has(action.model)) {
    client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] }).catch(() => undefined);
    return;
  }
  if (action.model === 'doc') {
    client.invalidateQueries({ queryKey: [DOCS_ROOT] }).catch(() => undefined);
    client.invalidateQueries({ queryKey: [DOC_ROOT, action.modelId] }).catch(() => undefined);
    return;
  }
  if (action.model === 'issue') patchIssueCaches(client, action);
  else if (action.model === 'comment') patchCommentCaches(client, action, applyCommentDelta);
  else if (action.model === 'reaction') patchCommentCaches(client, action, applyReactionDelta);
}

export interface DeltaBridgeProps {
  readonly organizationId: string;
  readonly teamIds: readonly string[];
}

export function DeltaBridge({ organizationId, teamIds }: DeltaBridgeProps) {
  const client = useQueryClient();

  const subscribed = useMemo(
    () => [scopes.organization(organizationId), ...teamIds.map((id) => scopes.team(id))],
    [organizationId, teamIds],
  );
  useScopeSubscription(subscribed);

  const handler = useCallback(
    (actions: SyncAction[]) => {
      const tabClientId = clientId();
      for (const action of actions) {
        if (!isOwnEcho(action, tabClientId)) applyAction(client, action);
      }
    },
    [client],
  );
  useDeltaHandler(handler);

  return null;
}
