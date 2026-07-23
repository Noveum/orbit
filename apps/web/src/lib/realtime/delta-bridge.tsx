'use client';

import {
  useDeltaHandler,
  useObserveSyncId,
  useResumeHandler,
  useScopeSubscription,
} from '@orbit/realtime-client/react';
import type { SyncAction, SyncModel } from '@orbit/shared/events';
import { scopes, syncCatchupSchema } from '@orbit/shared/events';
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { clientId } from '@/lib/query/client-id.ts';
import { apiFetch } from '@/lib/query/fetcher.ts';
import {
  ASSIGNED_SCOPE,
  BOOTSTRAP_ROOT,
  COMMENTS_ROOT,
  DOC_ROOT,
  DOCS_ROOT,
  ISSUE_ROOT,
  ISSUES_ROOT,
  VIEWS_ROOT,
} from '@/lib/query/keys.ts';
import type { Comment, Issue, IssueDetail } from '@/lib/query/schemas.ts';
import type { IssueBelongs, IssuePages } from '@/lib/query/sync.ts';
import {
  applyCommentDelta,
  applyIssueDeltaToPages,
  applyIssueDetailDelta,
  applyReactionDelta,
} from '@/lib/query/sync.ts';
import { useCurrentUserId } from './session.tsx';

const BOOTSTRAP_MODELS: ReadonlySet<SyncModel> = new Set<SyncModel>([
  'organization',
  'member',
  'invitation',
  'team',
  'team_member',
  'workflow_state',
  'label',
  'project',
  'milestone',
  'cycle',
]);

const DOC_MODELS: ReadonlySet<SyncModel> = new Set<SyncModel>(['doc', 'doc_collection']);

function noop(): undefined {
  return undefined;
}

interface RootInvalidations {
  bootstrap: boolean;
  views: boolean;
  docs: boolean;
  docIds: Set<string>;
}

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

function patchSubscription(
  client: QueryClient,
  action: SyncAction,
  currentUserId: string | null,
): void {
  const issueId = action.data['issueId'];
  const userId = action.data['userId'];
  if (typeof issueId !== 'string' || userId !== currentUserId) return;
  const subscribed = action.action !== 'delete';
  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUE_ROOT] })) {
    const current = query.state.data as IssueDetail | undefined;
    if (current === undefined || current.issue.id !== issueId) continue;
    if (current.subscribed === subscribed) continue;
    client.setQueryData(query.queryKey, { ...current, subscribed });
  }
}

function isOwnEcho(action: SyncAction, tabClientId: string): boolean {
  return action.originClientId === tabClientId;
}

function routeAction(
  client: QueryClient,
  action: SyncAction,
  currentUserId: string | null,
  roots: RootInvalidations,
): void {
  if (action.model === 'issue') {
    patchIssueCaches(client, action);
    return;
  }
  if (action.model === 'comment') {
    patchCommentCaches(client, action, applyCommentDelta);
    return;
  }
  if (action.model === 'reaction') {
    patchCommentCaches(client, action, applyReactionDelta);
    return;
  }
  if (action.model === 'issue_subscription') {
    patchSubscription(client, action, currentUserId);
    return;
  }
  if (DOC_MODELS.has(action.model)) {
    roots.docs = true;
    if (action.model === 'doc') roots.docIds.add(action.modelId);
    return;
  }
  if (action.model === 'view') {
    roots.views = true;
    return;
  }
  if (BOOTSTRAP_MODELS.has(action.model)) roots.bootstrap = true;
}

function flushRoots(client: QueryClient, roots: RootInvalidations): void {
  if (roots.bootstrap) client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] }).catch(noop);
  if (roots.views) client.invalidateQueries({ queryKey: [VIEWS_ROOT] }).catch(noop);
  if (roots.docs) client.invalidateQueries({ queryKey: [DOCS_ROOT] }).catch(noop);
  for (const docId of roots.docIds) {
    client.invalidateQueries({ queryKey: [DOC_ROOT, docId] }).catch(noop);
  }
}

export interface DeltaBridgeProps {
  readonly organizationId: string;
  readonly teamIds: readonly string[];
}

export function DeltaBridge({ organizationId, teamIds }: DeltaBridgeProps) {
  const client = useQueryClient();
  const currentUserId = useCurrentUserId();
  const observeSyncId = useObserveSyncId();

  const subscribed = useMemo(
    () => [scopes.organization(organizationId), ...teamIds.map((id) => scopes.team(id))],
    [organizationId, teamIds],
  );
  useScopeSubscription(subscribed);

  const applyActions = useCallback(
    (actions: readonly SyncAction[]) => {
      const tabClientId = clientId();
      const roots: RootInvalidations = {
        bootstrap: false,
        views: false,
        docs: false,
        docIds: new Set<string>(),
      };

      for (const action of actions) {
        if (isOwnEcho(action, tabClientId)) continue;
        routeAction(client, action, currentUserId, roots);
      }

      flushRoots(client, roots);
    },
    [client, currentUserId],
  );

  useDeltaHandler(useCallback((actions: SyncAction[]) => applyActions(actions), [applyActions]));

  useResumeHandler(
    useCallback(
      (since: number) => {
        apiFetch(`/api/sync?since=${since}`, syncCatchupSchema)
          .then((catchup) => {
            applyActions(catchup.actions);
            observeSyncId(catchup.syncId);
            if (catchup.truncated) client.invalidateQueries().catch(noop);
          })
          .catch(noop);
      },
      [applyActions, client, observeSyncId],
    ),
  );

  return null;
}
