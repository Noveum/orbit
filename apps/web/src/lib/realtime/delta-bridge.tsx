'use client';

import {
  useDeltaHandler,
  useObserveSyncId,
  useRealtimeStatus,
  useResumeHandler,
  useScopeSubscription,
} from '@orbit/realtime-client/react';
import type { SyncAction, SyncModel } from '@orbit/shared/events';
import { scopes, syncCatchupSchema } from '@orbit/shared/events';
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ANALYTICS_ROOT } from '@/features/analytics/analytics-keys.ts';
import { clientId } from '@/lib/query/client-id.ts';
import { apiFetch } from '@/lib/query/fetcher.ts';
import {
  issueRevisionGeneration,
  issueSurvivalSyncWatermark,
  issueSyncWatermark,
  recordIssueCacheReset,
  recordIssueDeletions,
  recordIssueListRevisions,
  recordIssueRevisions,
  recordIssueSurvivalSyncWatermark,
  recordIssueSyncWatermark,
} from '@/lib/query/issue-cache-generation.ts';
import {
  ALL_SCOPE,
  ASSIGNED_SCOPE,
  BOARD_ROOT,
  BOOTSTRAP_ROOT,
  COMMENTS_ROOT,
  CYCLE_SCOPE,
  DOC_COMMENTS_ROOT,
  DOC_ROOT,
  DOCS_HOME_ROOT,
  DOCS_ROOT,
  ISSUE_FACETS_ROOT,
  ISSUE_RELATIONS_ROOT,
  ISSUE_ROOT,
  ISSUE_SUMMARY_ROOT,
  ISSUES_ROOT,
  MILESTONES_ROOT,
  PROJECT_SCOPE,
  queryKeys,
  VIEWS_ROOT,
} from '@/lib/query/keys.ts';
import {
  type Comment,
  type DocComment,
  type Issue,
  type IssueDetail,
  issueDetailSchema,
  issueSchema,
} from '@/lib/query/schemas.ts';
import type { IssueBelongs, IssuePages } from '@/lib/query/sync.ts';
import {
  applyCommentDelta,
  applyDocCommentDelta,
  applyIssueDeltaToPages,
  applyIssueDetailDelta,
  applyReactionDelta,
  awaitsServerRefresh,
  belongsInList,
  flattenIssuePages,
  participatesIn,
  searchOf,
  withoutSubIssue,
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
  'cycle',
]);

const DOC_MODELS: ReadonlySet<SyncModel> = new Set<SyncModel>(['doc', 'doc_collection']);
const ANALYTICS_MODELS: ReadonlySet<SyncModel> = new Set<SyncModel>([
  'issue',
  'cycle',
  'project',
  'milestone',
  'workflow_state',
  'label',
  'member',
  'team',
  'view',
]);

function noop(): undefined {
  return undefined;
}

interface RootInvalidations {
  analytics: boolean;
  counts: boolean;
  boards: boolean;
  issueCaches: boolean;
  bootstrap: boolean;
  views: boolean;
  docs: boolean;
  relations: boolean;
  milestones: boolean;
  docIds: Set<string>;
}

function membershipOf(key: QueryKey): IssueBelongs | null {
  const scope = key[1];
  if (typeof scope !== 'string') return null;
  const search = searchOf(key);
  if (scope === ASSIGNED_SCOPE) {
    const userId = key[2];
    if (typeof userId !== 'string') return null;
    return (issue: Issue) => participatesIn(issue, userId) && belongsInList(search, issue);
  }
  if (scope === PROJECT_SCOPE) {
    const projectId = key[2];
    if (typeof projectId !== 'string') return null;
    return (issue: Issue) => issue.projectId === projectId && belongsInList(search, issue);
  }
  if (scope === CYCLE_SCOPE) {
    const cycleId = key[2];
    if (typeof cycleId !== 'string') return null;
    return (issue: Issue) => issue.cycleId === cycleId && belongsInList(search, issue);
  }
  if (scope === ALL_SCOPE) return (issue: Issue) => belongsInList(search, issue);
  return (issue: Issue) => issue.teamId === scope && belongsInList(search, issue);
}

function issueActionMayAffectQuery(action: SyncAction, key: QueryKey): boolean {
  const teamId = new URLSearchParams(searchOf(key)).get('teamId');
  return (
    teamId === null ||
    action.data['teamChanged'] === true ||
    action.scopes.includes(scopes.team(teamId))
  );
}

function restartEmptyOverlappingQuery(
  client: QueryClient,
  key: QueryKey,
  overlapsFetch: boolean,
): QueryKey[] {
  if (!overlapsFetch) return [];
  client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
  return [key];
}

function issueDetailIdentifierSets(
  client: QueryClient,
  action: SyncAction,
  previousIdentifiers: ReadonlySet<string>,
): { known: ReadonlySet<string>; moved: ReadonlySet<string>; stale: boolean } {
  const known = new Set(previousIdentifiers);
  const moved = new Set(previousIdentifiers);
  const cached = [
    ...client
      .getQueriesData<IssuePages>({ queryKey: [ISSUES_ROOT] })
      .flatMap(([, pages]) =>
        pages === undefined
          ? []
          : flattenIssuePages(pages).filter((issue) => issue.id === action.modelId),
      ),
    ...client
      .getQueriesData<IssueDetail>({ queryKey: [ISSUE_ROOT] })
      .flatMap(([, detail]) => (detail?.issue.id === action.modelId ? [detail.issue] : [])),
  ];
  const current = action.data['identifier'];
  const newestSyncId = cached.reduce(
    (newest, issue) => Math.max(newest, issue.syncId),
    issueSyncWatermark(client, action.modelId),
  );
  if (action.syncId < newestSyncId) return { known, moved, stale: true };
  for (const issue of cached) {
    if (issue.syncId !== newestSyncId) continue;
    known.add(issue.identifier);
    if (typeof current === 'string' && current !== issue.identifier) {
      moved.add(issue.identifier);
    }
  }
  return { known, moved, stale: false };
}

function patchIssueListCache(
  client: QueryClient,
  action: SyncAction,
  key: QueryKey,
  current: IssuePages | undefined,
  fetching: boolean,
): boolean {
  const belongs = membershipOf(key);
  if (belongs === null) return false;
  const overlapsFetch = fetching && issueActionMayAffectQuery(action, key);
  if (overlapsFetch) client.cancelQueries({ queryKey: key, exact: true }).catch(noop);
  if (current === undefined)
    return restartEmptyOverlappingQuery(client, key, overlapsFetch).length > 0;
  const search = searchOf(key);
  const cachedIssue = flattenIssuePages(current).find((issue) => issue.id === action.modelId);
  const next =
    cachedIssue !== undefined && action.syncId <= cachedIssue.syncId
      ? current
      : applyIssueDeltaToPages(current, action, belongs, search);
  if (next !== current) client.setQueryData(key, next);
  const refreshFromServer = awaitsServerRefresh(
    flattenIssuePages(current),
    action,
    belongs,
    search,
  );
  if (refreshFromServer || overlapsFetch) {
    client.invalidateQueries({ queryKey: key, exact: true }).catch(noop);
  }
  return next !== current || refreshFromServer || overlapsFetch;
}

function patchIssueCaches(
  client: QueryClient,
  action: SyncAction,
  preserveDeletedDetail: boolean,
  previousIdentifiers: ReadonlySet<string>,
): boolean {
  const detailIdentifiers = issueDetailIdentifierSets(client, action, previousIdentifiers);
  if (detailIdentifiers.stale) return false;
  recordIssueSyncWatermark(client, action.modelId, action.syncId);
  const revisedKeys: QueryKey[] = [];
  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUES_ROOT] })) {
    const current = query.state.data as IssuePages | undefined;
    const revised = patchIssueListCache(
      client,
      action,
      query.queryKey,
      current,
      query.state.fetchStatus === 'fetching',
    );
    if (revised) revisedKeys.push(query.queryKey);
  }

  recordIssueListRevisions(client, revisedKeys);
  patchIssueDetailCaches(
    client,
    action,
    preserveDeletedDetail,
    detailIdentifiers.known,
    detailIdentifiers.moved,
  );
  return true;
}

function patchDeletedIssueDetails(client: QueryClient, issueId: string): void {
  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUE_ROOT] })) {
    const current = query.state.data as IssueDetail | undefined;
    if (current === undefined) continue;
    if (current.issue.id === issueId) {
      client.resetQueries({ queryKey: query.queryKey, exact: true }).catch(noop);
      continue;
    }
    const parentRemoved = current.issue.parentId === issueId || current.parent?.id === issueId;
    const orphaned = parentRemoved
      ? {
          ...current,
          issue:
            current.issue.parentId === issueId
              ? { ...current.issue, parentId: null }
              : current.issue,
          parent: null,
        }
      : current;
    const trimmed = withoutSubIssue(orphaned, issueId);
    if (trimmed !== current) client.setQueryData(query.queryKey, trimmed);
  }
}

function forgetDeletedIssue(client: QueryClient, issueId: string): void {
  const fetchingKeys = client
    .getQueryCache()
    .findAll({ queryKey: [ISSUE_ROOT] })
    .flatMap((query) => (query.state.fetchStatus === 'fetching' ? [query.queryKey] : []));
  const cancellations = fetchingKeys.map((key) =>
    client.cancelQueries({ queryKey: key, exact: true }),
  );
  patchDeletedIssueDetails(client, issueId);
  Promise.allSettled(cancellations)
    .then(() => {
      patchDeletedIssueDetails(client, issueId);
      for (const key of fetchingKeys) {
        client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
      }
    })
    .catch(() => undefined);
}

function patchIssueDetailUpdates(client: QueryClient, action: SyncAction): void {
  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUE_ROOT] })) {
    const current = query.state.data as IssueDetail | undefined;
    if (current === undefined) continue;
    const next = applyIssueDetailDelta(current, action);
    if (next !== current) client.setQueryData(query.queryKey, next);
  }
}

function issueActionIdentifiers(
  action: SyncAction,
  previousIdentifiers: ReadonlySet<string>,
): ReadonlySet<string> {
  const identifiers = new Set(previousIdentifiers);
  const current = action.data['identifier'];
  if (typeof current === 'string') identifiers.add(current);
  return identifiers;
}

function realtimeIssueDetail(issue: Issue): IssueDetail {
  return {
    issue,
    descriptionHtml: '',
    activity: [],
    activityCursor: null,
    subIssues: [],
    parent: null,
    subscribed: false,
    attachments: [],
  };
}

function movedIssueDetail(current: IssueDetail, issue: Issue): IssueDetail | undefined {
  if (current.issue.id !== issue.id || current.issue.syncId > issue.syncId) return undefined;
  return {
    ...current,
    issue,
    ...(current.issue.description === issue.description ? {} : { descriptionHtml: '' }),
  };
}

function migrateMovedIssueDetails(
  client: QueryClient,
  action: SyncAction,
  previousIdentifiers: ReadonlySet<string>,
): void {
  if (previousIdentifiers.size === 0) return;
  const parsed = issueSchema.safeParse(action.data);
  if (!parsed.success) return;
  const nextKey = queryKeys.issue(parsed.data.identifier);
  let migrated: IssueDetail | undefined;
  for (const identifier of previousIdentifiers) {
    if (identifier === parsed.data.identifier) continue;
    const previousKey = queryKeys.issue(identifier);
    if (client.getQueryState(previousKey) === undefined) continue;
    const current = client.getQueryData<IssueDetail>(previousKey);
    const next =
      current === undefined
        ? realtimeIssueDetail(parsed.data)
        : movedIssueDetail(current, parsed.data);
    if (next === undefined) continue;
    client.setQueryData(previousKey, next);
    if (migrated === undefined || current !== undefined) migrated = next;
  }
  if (migrated === undefined) return;
  client.setQueryData<IssueDetail>(nextKey, (current) =>
    current === undefined ? migrated : (movedIssueDetail(current, parsed.data) ?? current),
  );
  client.invalidateQueries({ queryKey: nextKey, exact: true }).catch(() => undefined);
}

function patchIssueDetailCaches(
  client: QueryClient,
  action: SyncAction,
  preserveDeletedDetail: boolean,
  knownIdentifiers: ReadonlySet<string>,
  movedIdentifiers: ReadonlySet<string>,
): void {
  if (action.action === 'delete') {
    if (!preserveDeletedDetail) forgetDeletedIssue(client, action.modelId);
    return;
  }
  const identifiers = issueActionIdentifiers(action, knownIdentifiers);
  const fetchingKeys = client
    .getQueryCache()
    .findAll({ queryKey: [ISSUE_ROOT] })
    .flatMap((query) => {
      const current = query.state.data as IssueDetail | undefined;
      if (query.state.fetchStatus !== 'fetching') return [];
      if (current?.issue.id === action.modelId) return [query.queryKey];
      const queryIdentifier = query.queryKey[1];
      return current === undefined &&
        typeof queryIdentifier === 'string' &&
        (identifiers.size === 0 || identifiers.has(queryIdentifier))
        ? [query.queryKey]
        : [];
    });
  const cancellations = fetchingKeys.map((key) =>
    client.cancelQueries({ queryKey: key, exact: true }),
  );
  patchIssueDetailUpdates(client, action);
  Promise.allSettled(cancellations)
    .then(() => {
      patchIssueDetailUpdates(client, action);
      migrateMovedIssueDetails(client, action, movedIdentifiers);
      for (const key of fetchingKeys) {
        if (movedIdentifiers.has(String(key[1] ?? ''))) continue;
        client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
      }
    })
    .catch(() => undefined);
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

function patchDocCommentCaches(client: QueryClient, action: SyncAction): void {
  const targetDocId = action.data['docId'];
  for (const query of client.getQueryCache().findAll({ queryKey: [DOC_COMMENTS_ROOT] })) {
    if (query.queryKey[1] !== targetDocId) continue;
    const current = query.state.data as readonly DocComment[] | undefined;
    if (current === undefined) continue;
    const next = applyDocCommentDelta(current, action);
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

function cachedIssueSurvivesDeparture(client: QueryClient, action: SyncAction): boolean {
  const departureIdentifier = action.data['identifier'];
  const departureTeamId = action.data['teamId'];
  if (typeof departureIdentifier !== 'string' || typeof departureTeamId !== 'string') return false;
  const survives = (issue: Issue): boolean =>
    issue.id === action.modelId &&
    issue.syncId >= action.syncId &&
    (issue.identifier !== departureIdentifier || issue.teamId !== departureTeamId);
  return (
    client
      .getQueriesData<IssuePages>({ queryKey: [ISSUES_ROOT] })
      .some(([, pages]) => pages !== undefined && flattenIssuePages(pages).some(survives)) ||
    client
      .getQueriesData<IssueDetail>({ queryKey: [ISSUE_ROOT] })
      .some(([, detail]) => detail !== undefined && survives(detail.issue))
  );
}

function pairedIssueDeparture(
  client: QueryClient,
  action: SyncAction,
  survivingIssueIds: ReadonlySet<string>,
): boolean {
  return (
    action.action === 'delete' &&
    action.data['departure'] === true &&
    (survivingIssueIds.has(action.modelId) ||
      issueSurvivalSyncWatermark(client, action.modelId) >= action.syncId ||
      cachedIssueSurvivesDeparture(client, action))
  );
}

function issueActionSupersedes(current: SyncAction, candidate: SyncAction): boolean {
  if (candidate.syncId !== current.syncId) return candidate.syncId > current.syncId;
  const currentHardDelete = current.action === 'delete' && current.data['departure'] !== true;
  const candidateHardDelete = candidate.action === 'delete' && candidate.data['departure'] !== true;
  if (currentHardDelete !== candidateHardDelete) return candidateHardDelete;
  const currentSurvives = current.action !== 'delete';
  const candidateSurvives = candidate.action !== 'delete';
  if (currentSurvives !== candidateSurvives) return candidateSurvives;
  return true;
}

function preferredFinalIssueActions(
  actions: readonly SyncAction[],
  tabClientId?: string,
): ReadonlyMap<string, SyncAction> {
  const finalActions = new Map<string, SyncAction>();
  for (const action of actions) {
    if (action.model !== 'issue') continue;
    if (tabClientId !== undefined && isOwnEcho(action, tabClientId)) continue;
    const current = finalActions.get(action.modelId);
    if (current === undefined || issueActionSupersedes(current, action)) {
      finalActions.set(action.modelId, action);
    }
  }
  return finalActions;
}

function finalSurvivingIssueIds(actions: readonly SyncAction[]): ReadonlySet<string> {
  return new Set(
    [...preferredFinalIssueActions(actions)].flatMap(([issueId, action]) =>
      action.action === 'delete' ? [] : [issueId],
    ),
  );
}

function issueMoveKey(action: SyncAction): string {
  return action.modelId;
}

function issueMovePreviousIdentifiers(
  actions: readonly SyncAction[],
  tabClientId: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const previous = new Map<string, Set<string>>();
  for (const action of actions) {
    if (isOwnEcho(action, tabClientId) || action.model !== 'issue') continue;
    if (action.action !== 'delete' || action.data['departure'] !== true) continue;
    const identifier = action.data['identifier'];
    if (typeof identifier !== 'string') continue;
    const key = issueMoveKey(action);
    const identifiers = previous.get(key) ?? new Set<string>();
    identifiers.add(identifier);
    previous.set(key, identifiers);
  }
  return previous;
}

function finalSurvivingIssueActions(
  actions: readonly SyncAction[],
  tabClientId: string,
): ReadonlyMap<string, SyncAction> {
  return new Map(
    [...preferredFinalIssueActions(actions, tabClientId)].filter(
      ([, action]) => action.action !== 'delete',
    ),
  );
}

function recordIssueGeneration(
  client: QueryClient,
  action: SyncAction,
  preserveDeletedDetail: boolean,
): void {
  if (action.action !== 'delete') {
    recordIssueSurvivalSyncWatermark(client, action.modelId, action.syncId);
    recordIssueRevisions(client, [action.modelId]);
    return;
  }
  if (!preserveDeletedDetail) recordIssueDeletions(client, [action.modelId]);
}

function recordOwnIssueEcho(client: QueryClient, action: SyncAction): void {
  if (action.model !== 'issue') return;
  if (action.syncId < issueSyncWatermark(client, action.modelId)) return;
  recordIssueSyncWatermark(client, action.modelId, action.syncId);
  if (action.action === 'delete' && action.data['departure'] === true) {
    recordIssueRevisions(client, [action.modelId]);
    return;
  }
  recordIssueGeneration(client, action, action.data['departure'] === true);
}

function routeAction(
  client: QueryClient,
  action: SyncAction,
  currentUserId: string | null,
  roots: RootInvalidations,
  survivingIssueIds: ReadonlySet<string>,
  previousIssueIdentifiers: ReadonlyMap<string, ReadonlySet<string>>,
  finalIssueActions: ReadonlyMap<string, SyncAction>,
): void {
  if (action.model === 'issue') {
    const preserveDeletedDetail = pairedIssueDeparture(client, action, survivingIssueIds);
    const previousIdentifiers =
      finalIssueActions.get(action.modelId) === action
        ? (previousIssueIdentifiers.get(issueMoveKey(action)) ?? new Set())
        : new Set<string>();
    const applied = patchIssueCaches(client, action, preserveDeletedDetail, previousIdentifiers);
    if (applied) recordIssueGeneration(client, action, preserveDeletedDetail);
    roots.counts = true;
    roots.milestones = true;
    roots.boards = true;
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
  if (action.model === 'doc_comment') {
    patchDocCommentCaches(client, action);
    return;
  }
  if (action.model === 'issue_subscription') {
    patchSubscription(client, action, currentUserId);
    return;
  }
  if (action.model === 'issue_relation') {
    roots.relations = true;
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
  if (action.model === 'milestone') {
    roots.milestones = true;
    return;
  }
  if (BOOTSTRAP_MODELS.has(action.model)) roots.bootstrap = true;
}

function flushRoots(client: QueryClient, roots: RootInvalidations): void {
  if (roots.analytics) client.invalidateQueries({ queryKey: [ANALYTICS_ROOT] }).catch(noop);
  if (roots.counts) {
    client.invalidateQueries({ queryKey: [ISSUE_SUMMARY_ROOT] }).catch(noop);
    client.invalidateQueries({ queryKey: [ISSUE_FACETS_ROOT] }).catch(noop);
  }
  if (roots.boards) {
    client.invalidateQueries({ queryKey: [BOARD_ROOT], refetchType: 'none' }).catch(noop);
  }
  if (roots.issueCaches) {
    client.invalidateQueries({ queryKey: [ISSUES_ROOT] }).catch(noop);
    client.invalidateQueries({ queryKey: [ISSUE_ROOT] }).catch(noop);
  }
  if (roots.bootstrap) client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] }).catch(noop);
  if (roots.views) client.invalidateQueries({ queryKey: [VIEWS_ROOT] }).catch(noop);
  if (roots.relations) {
    client.invalidateQueries({ queryKey: [ISSUE_RELATIONS_ROOT] }).catch(noop);
  }
  if (roots.milestones) client.invalidateQueries({ queryKey: [MILESTONES_ROOT] }).catch(noop);
  if (roots.docs) {
    client.invalidateQueries({ queryKey: [DOCS_ROOT] }).catch(noop);
    client.invalidateQueries({ queryKey: [DOCS_HOME_ROOT] }).catch(noop);
  }
  for (const docId of roots.docIds) {
    client.invalidateQueries({ queryKey: [DOC_ROOT, docId] }).catch(noop);
  }
}

async function resetIssueCaches(client: QueryClient): Promise<void> {
  recordIssueCacheReset(client);
  await Promise.allSettled([
    client.resetQueries({ queryKey: [ISSUES_ROOT] }),
    client.resetQueries({ queryKey: [ISSUE_ROOT] }),
    client.resetQueries({ queryKey: [BOARD_ROOT] }),
  ]);
}

interface IssueDetailRecovery {
  readonly keys: readonly QueryKey[];
  readonly issueId: string;
  readonly revision: number;
}

function issueDetailRecoveries(client: QueryClient): IssueDetailRecovery[] {
  const recoveries = new Map<string, { keys: QueryKey[]; issueId: string; revision: number }>();
  for (const query of client.getQueryCache().findAll({ queryKey: [ISSUE_ROOT], type: 'active' })) {
    const detail = query.state.data as IssueDetail | undefined;
    if (detail === undefined) continue;
    const current = recoveries.get(detail.issue.id);
    if (current !== undefined) {
      current.keys.push(query.queryKey);
      continue;
    }
    recoveries.set(detail.issue.id, {
      keys: [query.queryKey],
      issueId: detail.issue.id,
      revision: issueRevisionGeneration(client, detail.issue.id),
    });
  }
  return [...recoveries.values()];
}

function seedRecoveredIssueDetail(client: QueryClient, key: QueryKey, detail: IssueDetail): void {
  client.setQueryData<IssueDetail>(key, (current) =>
    current !== undefined && current.issue.syncId > detail.issue.syncId ? current : detail,
  );
}

async function recoverIssueDetails(
  client: QueryClient,
  recoveries: readonly IssueDetailRecovery[],
  signal: AbortSignal,
  current: () => boolean,
): Promise<void> {
  await Promise.all(
    recoveries.map(async (recovery) => {
      try {
        const detail = await apiFetch(
          `/api/issues/${encodeURIComponent(recovery.issueId)}`,
          issueDetailSchema,
          { signal },
        );
        if (!current() || detail.issue.id !== recovery.issueId) return;
        if (issueRevisionGeneration(client, recovery.issueId) !== recovery.revision) return;
        recordIssueSyncWatermark(client, recovery.issueId, detail.issue.syncId);
        recordIssueSurvivalSyncWatermark(client, recovery.issueId, detail.issue.syncId);
        for (const key of recovery.keys) seedRecoveredIssueDetail(client, key, detail);
        seedRecoveredIssueDetail(client, queryKeys.issue(detail.issue.identifier), detail);
      } catch {
        return;
      }
    }),
  );
}

async function invalidateNonIssueCaches(client: QueryClient): Promise<void> {
  await client.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return root !== ISSUES_ROOT && root !== ISSUE_ROOT && root !== BOARD_ROOT;
    },
  });
}

interface ResumeReconciliation {
  readonly client: QueryClient;
  readonly since: number;
  readonly detailRecoveries: readonly IssueDetailRecovery[];
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly applyActions: (actions: readonly SyncAction[]) => boolean;
  readonly observeSyncId: (syncId: number) => void;
}

async function reconcileCatchup(
  reconciliation: ResumeReconciliation,
  recovery: Promise<void>,
): Promise<void> {
  const { client, since, signal, current, applyActions, observeSyncId } = reconciliation;
  const [catchup] = await Promise.all([
    apiFetch(`/api/sync?since=${since}`, syncCatchupSchema, { signal }),
    recovery,
  ]);
  if (!current()) return;
  const appliedBootstrap = applyActions(catchup.actions);
  observeSyncId(catchup.syncId);
  if (catchup.truncated) {
    await client.invalidateQueries();
  } else if (!appliedBootstrap) {
    await client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] });
  }
}

async function reconcileResume(reconciliation: ResumeReconciliation): Promise<void> {
  const { client, since, detailRecoveries, signal, current } = reconciliation;
  await resetIssueCaches(client);
  if (!current()) return;
  const recovery = recoverIssueDetails(client, detailRecoveries, signal, current);
  if (since === 0) {
    await Promise.all([recovery, invalidateNonIssueCaches(client)]);
    return;
  }
  await reconcileCatchup(reconciliation, recovery);
}

export interface DeltaBridgeProps {
  readonly organizationId: string;
  readonly teamIds: readonly string[];
}

export function DeltaBridge({ organizationId, teamIds }: DeltaBridgeProps) {
  const client = useQueryClient();
  const currentUserId = useCurrentUserId();
  const observeSyncId = useObserveSyncId();
  const realtimeStatus = useRealtimeStatus();
  const reconciledOrganization = useRef<string | null>(null);
  const resumeEpoch = useRef(0);
  const resumeAbort = useRef<AbortController | null>(null);
  const resumeOrganization = useRef(organizationId);

  useEffect(() => {
    if (resumeOrganization.current === organizationId) return;
    resumeOrganization.current = organizationId;
    resumeEpoch.current += 1;
    resumeAbort.current?.abort();
    resumeAbort.current = null;
  }, [organizationId]);

  useEffect(() => {
    return () => {
      resumeEpoch.current += 1;
      resumeAbort.current?.abort();
      resumeAbort.current = null;
    };
  }, []);

  useEffect(() => {
    if (realtimeStatus !== 'open' || reconciledOrganization.current === organizationId) return;
    reconciledOrganization.current = organizationId;
    client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] }).catch(noop);
  }, [client, organizationId, realtimeStatus]);

  const subscribed = useMemo(
    () => [
      scopes.organization(organizationId),
      ...teamIds.map((id) => scopes.team(id)),
      ...(currentUserId === null ? [] : [scopes.user(currentUserId)]),
    ],
    [organizationId, teamIds, currentUserId],
  );
  useScopeSubscription(subscribed);

  const applyActions = useCallback(
    (actions: readonly SyncAction[]) => {
      const tabClientId = clientId();
      const survivingIssueIds = finalSurvivingIssueIds(actions);
      const previousIssueIdentifiers = issueMovePreviousIdentifiers(actions, tabClientId);
      const finalIssueActions = finalSurvivingIssueActions(actions, tabClientId);
      const roots: RootInvalidations = {
        analytics: false,
        counts: false,
        boards: false,
        issueCaches: false,
        bootstrap: false,
        views: false,
        docs: false,
        relations: false,
        milestones: false,
        docIds: new Set<string>(),
      };

      for (const action of actions) {
        if (ANALYTICS_MODELS.has(action.model)) roots.analytics = true;
        if (action.model === 'issue') {
          roots.counts = true;
          roots.milestones = true;
          roots.boards = true;
        }
        if (isOwnEcho(action, tabClientId)) {
          recordOwnIssueEcho(client, action);
          if (action.model === 'issue') roots.issueCaches = true;
          continue;
        }
        routeAction(
          client,
          action,
          currentUserId,
          roots,
          survivingIssueIds,
          previousIssueIdentifiers,
          finalIssueActions,
        );
      }

      flushRoots(client, roots);
      return roots.bootstrap;
    },
    [client, currentUserId],
  );

  useDeltaHandler(applyActions);

  useResumeHandler(
    useCallback(
      (since: number) => {
        const detailRecoveries = issueDetailRecoveries(client);
        const epoch = resumeEpoch.current + 1;
        resumeEpoch.current = epoch;
        resumeAbort.current?.abort();
        const controller = new AbortController();
        resumeAbort.current = controller;
        const current = () => resumeEpoch.current === epoch && !controller.signal.aborted;

        const reconcile = async (): Promise<void> => {
          try {
            await reconcileResume({
              client,
              since,
              detailRecoveries,
              signal: controller.signal,
              current,
              applyActions,
              observeSyncId,
            });
          } catch {
            if (current()) await invalidateNonIssueCaches(client).catch(noop);
          } finally {
            if (current()) resumeAbort.current = null;
          }
        };

        reconcile().catch(noop);
      },
      [applyActions, client, observeSyncId],
    ),
  );

  return null;
}
