import type { SyncAction } from '@orbit/shared/events';
import type { IssueActor } from '@orbit/shared/validators';
import type { Query, QueryCacheNotifyEvent, QueryClient, QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import { type IssueActorRole, resolveIssueActor } from './issue-actors.ts';
import {
  issueListRevisionGeneration,
  issueRevisionGeneration,
  recordIssueListRevisions,
  recordIssueRevisions,
} from './issue-cache-generation.ts';
import {
  BOARD_ROOT,
  BOOTSTRAP_ROOT,
  ISSUE_RELATIONS_ROOT,
  ISSUE_ROOT,
  ISSUES_ROOT,
} from './keys.ts';
import type { BoardPage, Bootstrap, Issue, IssueDetail, IssueRelation } from './schemas.ts';
import { bootstrapSchema } from './schemas.ts';
import type { IssuePages } from './sync.ts';
import { mapIssuePages } from './sync.ts';

const memberProfileSchema = z.object({
  userId: z.string(),
  organizationId: z.string().optional(),
  isAgent: z.boolean().optional(),
  name: z.string().optional(),
  image: z.string().nullable().optional(),
});

interface MemberProfile {
  readonly userId: string;
  readonly name?: string | undefined;
  readonly image?: string | null | undefined;
}

interface ProfileUpdate {
  readonly syncId: number;
  readonly dataUpdatedAt: number;
  readonly profile: MemberProfile;
  readonly pending: boolean;
}

interface ActorCache {
  organizationId: string;
  teamIds: ReadonlySet<string>;
  readonly profiles: Map<string, ProfileUpdate>;
  readonly revisions: Map<string, number>;
  readonly listRevisions: Map<string, number>;
  readonly bootstrapSources: WeakMap<
    Query,
    { readonly data: unknown; readonly source: ProfileSource }
  >;
  patching: boolean;
}

const actorCaches = new WeakMap<QueryClient, ActorCache>();

function actorCache(client: QueryClient): ActorCache {
  let cache = actorCaches.get(client);
  if (cache === undefined) {
    cache = {
      organizationId: '',
      teamIds: new Set(),
      profiles: new Map(),
      revisions: new Map(),
      listRevisions: new Map(),
      bootstrapSources: new WeakMap(),
      patching: false,
    };
    actorCaches.set(client, cache);
  }
  return cache;
}

function profileKey(organizationId: string, userId: string): string {
  return JSON.stringify([organizationId, userId]);
}

function issueOrganization(cache: ActorCache, issue: Issue): string {
  return issue.organizationId || (cache.teamIds.has(issue.teamId) ? cache.organizationId : '');
}

export function replayIssueActorProfiles(client: QueryClient, issue: Issue): Issue {
  const cache = actorCaches.get(client);
  if (cache === undefined) return issue;
  const organizationId = issueOrganization(cache, issue);
  if (organizationId === '') return issue;
  let next = issue;
  for (const role of ['creator', 'assignee', 'owner'] as const) {
    const actor = replayActorProfile(cache, organizationId, issue, role);
    if (actor !== issue[role]) next = { ...next, [role]: actor };
  }
  return next;
}

function replayActorProfile(
  cache: ActorCache,
  organizationId: string,
  issue: Issue,
  role: IssueActorRole,
): IssueActor | null | undefined {
  const actor = resolveIssueActor(issue, role);
  if (actor?.type !== 'user') return issue[role];
  const profile = cache.profiles.get(profileKey(organizationId, actor.id))?.profile;
  if (profile === undefined || (profile.name === undefined && profile.image === undefined))
    return issue[role];
  if (issue[role] === undefined && (profile.name === undefined || profile.image === undefined))
    return undefined;
  const updated = {
    ...actor,
    ...(profile.name === undefined ? {} : { name: profile.name }),
    ...(profile.image === undefined ? {} : { avatar: profile.image }),
  };
  return issue[role] !== undefined && actor.name === updated.name && actor.avatar === updated.avatar
    ? actor
    : updated;
}

export function issueMutationRevisionGeneration(client: QueryClient, issueId: string): number {
  return (
    issueRevisionGeneration(client, issueId) -
    (actorCaches.get(client)?.revisions.get(issueId) ?? 0)
  );
}

export function issueMutationListRevisionGeneration(client: QueryClient, key: QueryKey): number {
  return (
    issueListRevisionGeneration(client, key) -
    (actorCaches.get(client)?.listRevisions.get(JSON.stringify(key)) ?? 0)
  );
}

function patchActorCaches(client: QueryClient): void {
  const cache = actorCache(client);
  if (cache.patching || cache.profiles.size === 0) return;
  cache.patching = true;
  const changed = new Set<string>();
  const update = (issue: Issue) => {
    const next = replayIssueActorProfiles(client, issue);
    if (next !== issue) changed.add(issue.id);
    return next;
  };
  try {
    for (const query of client.getQueryCache().findAll()) {
      const current = query.state.data;
      if (current === undefined) continue;
      const next = patchActorQueryData(query.queryKey[0], current, update);
      if (next === current) continue;
      const bootstrapSource = cache.bootstrapSources.get(query);
      const stored = client.setQueryData(query.queryKey, next, {
        updatedAt: query.state.dataUpdatedAt,
      });
      if (bootstrapSource !== undefined)
        cache.bootstrapSources.set(query, { ...bootstrapSource, data: stored });
      if (query.queryKey[0] === ISSUES_ROOT) {
        const key = JSON.stringify(query.queryKey);
        cache.listRevisions.set(key, (cache.listRevisions.get(key) ?? 0) + 1);
        recordIssueListRevisions(client, [query.queryKey]);
      }
    }
    for (const id of changed) cache.revisions.set(id, (cache.revisions.get(id) ?? 0) + 1);
    recordIssueRevisions(client, [...changed]);
  } finally {
    cache.patching = false;
  }
}

type IssueUpdater = (issue: Issue) => Issue;

function updateActorRows<T extends readonly Issue[]>(issues: T, update: IssueUpdater): T | Issue[] {
  const next = issues.map(update);
  return next.some((issue, index) => issue !== issues[index]) ? next : issues;
}

function updateDetailActors(detail: IssueDetail, update: IssueUpdater): IssueDetail {
  const issue = update(detail.issue);
  const parent =
    detail.parent === undefined || detail.parent === null ? detail.parent : update(detail.parent);
  const subIssues = updateActorRows(detail.subIssues, update);
  return issue === detail.issue && parent === detail.parent && subIssues === detail.subIssues
    ? detail
    : { ...detail, issue, ...(parent === undefined ? {} : { parent }), subIssues };
}

function updateRelationActors(
  relations: readonly IssueRelation[],
  update: IssueUpdater,
): readonly IssueRelation[] {
  const next = relations.map((relation) => {
    const issue = update(relation.issue);
    return issue === relation.issue ? relation : { ...relation, issue };
  });
  return next.some((relation, index) => relation !== relations[index]) ? next : relations;
}

function updateBoardActors(board: BoardPage, update: IssueUpdater): BoardPage {
  const groups = board.groups.map((group) => {
    const issues = updateActorRows(group.issues, update);
    return issues === group.issues ? group : { ...group, issues };
  });
  return groups.some((group, index) => group !== board.groups[index])
    ? { ...board, groups }
    : board;
}

function patchActorQueryData(root: unknown, current: unknown, update: IssueUpdater): unknown {
  switch (root) {
    case ISSUES_ROOT:
      return mapIssuePages(current as IssuePages, (issues) => updateActorRows(issues, update));
    case ISSUE_ROOT:
      return updateDetailActors(current as IssueDetail, update);
    case ISSUE_RELATIONS_ROOT:
      return updateRelationActors(current as readonly IssueRelation[], update);
    case BOARD_ROOT:
      return updateBoardActors(current as BoardPage, update);
    case BOOTSTRAP_ROOT: {
      const bootstrap = current as Bootstrap;
      if (bootstrap.issues === undefined) return current;
      const issues = updateActorRows(bootstrap.issues, update);
      return issues === bootstrap.issues ? current : { ...bootstrap, issues };
    }
    default:
      return current;
  }
}

export function recordMemberActorUpdate(
  client: QueryClient,
  action: SyncAction,
  organizationId: string,
): boolean {
  if (action.model !== 'member' || action.organizationId !== organizationId) return false;
  if (action.action !== 'insert' && action.action !== 'update') return true;
  const parsed = memberProfileSchema.safeParse(action.data);
  if (!parsed.success || parsed.data.isAgent === true) return true;
  if (parsed.data.organizationId !== undefined && parsed.data.organizationId !== organizationId)
    return true;
  const cache = actorCache(client);
  const key = profileKey(organizationId, parsed.data.userId);
  const previous = cache.profiles.get(key);
  if (previous !== undefined && action.syncId <= previous.syncId) return true;
  const { userId, name, image } = parsed.data;
  cache.profiles.set(key, {
    syncId: action.syncId,
    dataUpdatedAt:
      name === undefined && image === undefined
        ? (previous?.dataUpdatedAt ?? Number.NEGATIVE_INFINITY)
        : Date.now(),
    profile: {
      ...previous?.profile,
      userId,
      ...(name === undefined ? {} : { name }),
      ...(image === undefined ? {} : { image }),
    },
    pending: name === undefined && image === undefined,
  });
  const fetching = client
    .getQueryCache()
    .findAll()
    .filter(
      (query) =>
        query.state.fetchStatus === 'fetching' &&
        [BOOTSTRAP_ROOT, ISSUES_ROOT, ISSUE_ROOT, ISSUE_RELATIONS_ROOT, BOARD_ROOT].includes(
          String(query.queryKey[0]),
        ),
    );
  if (fetching.length > 0) {
    Promise.allSettled(
      fetching.map((query) => client.cancelQueries({ queryKey: query.queryKey, exact: true })),
    ).then(() => {
      patchActorCaches(client);
      for (const query of fetching) {
        client
          .invalidateQueries({ queryKey: query.queryKey, exact: true }, { cancelRefetch: false })
          .catch(() => undefined);
      }
    });
  }
  patchActorCaches(client);
  return true;
}

function acceptFetchedActors(
  cache: ActorCache,
  data: unknown,
  root: unknown,
  dataUpdatedAt: number,
  source: 'fetch' | 'restore' = 'fetch',
): void {
  let rows: readonly Issue[];
  switch (root) {
    case ISSUES_ROOT:
      rows = (data as IssuePages).pages.flatMap((page) => page.issues);
      break;
    case ISSUE_ROOT: {
      const detail = data as IssueDetail;
      rows = [
        detail.issue,
        ...detail.subIssues,
        ...(detail.parent === undefined || detail.parent === null ? [] : [detail.parent]),
      ];
      break;
    }
    case ISSUE_RELATIONS_ROOT:
      rows = (data as readonly IssueRelation[]).map((relation) => relation.issue);
      break;
    case BOARD_ROOT:
      rows = (data as BoardPage).groups.flatMap((group) => group.issues);
      break;
    default:
      return;
  }
  for (const issue of rows) {
    const organizationId = issueOrganization(cache, issue);
    if (organizationId === '') continue;
    for (const role of ['creator', 'assignee', 'owner'] as const) {
      const actor = issue[role];
      if (actor?.type !== 'user') continue;
      const key = profileKey(organizationId, actor.id);
      const previous = cache.profiles.get(key);
      if (source === 'restore' && !canRestoreProfile(previous, dataUpdatedAt)) continue;
      cache.profiles.set(key, {
        syncId: previous?.syncId ?? Number.NEGATIVE_INFINITY,
        dataUpdatedAt,
        pending: false,
        profile: { userId: actor.id, name: actor.name, image: actor.avatar },
      });
    }
  }
}

type ProfileSource = 'fetch' | 'restore' | 'manual';

function canRestoreProfile(previous: ProfileUpdate | undefined, dataUpdatedAt: number): boolean {
  return previous === undefined || (!previous.pending && dataUpdatedAt > previous.dataUpdatedAt);
}

function profileSource(event: QueryCacheNotifyEvent): ProfileSource | undefined {
  if (event.type === 'added') return 'restore';
  if (event.type !== 'updated') return undefined;
  if (event.action.type === 'setState') return 'restore';
  if (event.action.type !== 'success') return undefined;
  return event.action.manual === true ? 'manual' : 'fetch';
}

export function observeIssueActorProfiles(
  client: QueryClient,
  organizationId: string,
  teamIds: readonly string[],
): () => void {
  const cache = actorCache(client);
  cache.organizationId = organizationId;
  cache.teamIds = new Set(teamIds);
  const stop = client.getQueryCache().subscribe((event) => {
    if (cache.patching || event.query.state.data === undefined) return;
    const source = profileSource(event);
    if (source === undefined) return;
    if (event.query.queryKey[0] === BOOTSTRAP_ROOT) {
      cache.bootstrapSources.set(event.query, { data: event.query.state.data, source });
      acceptBootstrapProfiles(
        cache,
        event.query.state.data,
        organizationId,
        source,
        event.query.state.dataUpdatedAt,
      );
    } else if (source === 'fetch') {
      acceptFetchedActors(
        cache,
        event.query.state.data,
        event.query.queryKey[0],
        event.query.state.dataUpdatedAt,
      );
    }
    patchActorCaches(client);
  });
  const bootstrapUpdatedAt = seedCachedBootstrapProfiles(client, cache, organizationId);
  if (bootstrapUpdatedAt !== undefined) {
    for (const query of client
      .getQueryCache()
      .findAll()
      .toSorted((left, right) => left.state.dataUpdatedAt - right.state.dataUpdatedAt)) {
      if (query.state.data !== undefined && query.state.dataUpdatedAt > bootstrapUpdatedAt)
        acceptFetchedActors(
          cache,
          query.state.data,
          query.queryKey[0],
          query.state.dataUpdatedAt,
          'restore',
        );
    }
  }
  patchActorCaches(client);
  return stop;
}

function seedCachedBootstrapProfiles(
  client: QueryClient,
  cache: ActorCache,
  organizationId: string,
): number | undefined {
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: [BOOTSTRAP_ROOT] })
    .toSorted((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)) {
    const parsed = bootstrapSchema.safeParse(query.state.data);
    if (!parsed.success || parsed.data.organizationId !== organizationId) continue;
    const snapshot = cache.bootstrapSources.get(query);
    const source =
      snapshot?.data === query.state.data && snapshot?.source === 'manual' ? 'manual' : 'restore';
    acceptBootstrapProfiles(cache, parsed.data, organizationId, source, query.state.dataUpdatedAt);
    return query.state.dataUpdatedAt;
  }
  return undefined;
}

function acceptBootstrapProfiles(
  cache: ActorCache,
  data: unknown,
  organizationId: string,
  source: ProfileSource,
  dataUpdatedAt: number,
): void {
  const parsed = bootstrapSchema.safeParse(data);
  if (!parsed.success || parsed.data.organizationId !== organizationId) return;
  for (const member of parsed.data.members) {
    if (member.isAgent === true) continue;
    const key = profileKey(organizationId, member.id);
    const update = cache.profiles.get(key);
    if (update !== undefined) {
      if (source === 'manual' && !update.pending) continue;
      if (source === 'restore' && dataUpdatedAt <= update.dataUpdatedAt) continue;
    }
    cache.profiles.set(key, {
      syncId: update?.syncId ?? Number.NEGATIVE_INFINITY,
      dataUpdatedAt,
      pending: false,
      profile: { userId: member.id, name: member.name, image: member.image },
    });
  }
}
