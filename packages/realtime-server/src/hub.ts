import { randomUUID } from 'node:crypto';
import {
  clientMessageSchema,
  controlMessageSchema,
  DELTA_BATCH_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  PRESENCE_TTL_MS,
  type PresenceKind,
  presenceMessageSchema,
  REDIS_CONTROL_CHANNEL,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
  SESSION_REVOKED_CLOSE_CODE,
  type SyncAction,
  scopes,
  syncActionSchema,
  UNAUTHORIZED_CLOSE_CODE,
} from '@orbit/shared/events';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  authenticateTicket,
  authorizedIssueTeamId,
  authorizeScope,
  type ConnectionRejection,
  issueReachInOrganization,
  issueTeamIdInOrganization,
  liveSessionIds,
  memberDeleteSchema,
  membershipStillValid,
  readTicketFrame,
  refreshedPrincipal,
  sessionStillValid,
} from './auth.ts';
import { Connection, type SocketState } from './connection.ts';
import { IssueTeamBoundaries, type IssueTeamBoundary } from './issue-team-boundaries.ts';
import { errorFields, logger } from './logger.ts';
import { PresenceStore } from './presence.ts';
import { type RealtimeSocket, SOCKET_OPEN } from './socket.ts';

export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 256;
export const MAX_BUFFERED_BYTES = 1_048_576;
export const MESSAGE_BURST = 60;
export const MESSAGES_PER_SECOND = 20;
export const AUTH_TIMEOUT_MS = 10_000;
export const SESSION_SWEEP_INTERVAL_MS = 60_000;
export const ISSUE_TEAM_BOUNDARY_TTL_MS = 300_000;
export const MAX_ISSUE_TEAM_BOUNDARIES = 10_000;

export interface RealtimeHubOptions {
  redisUrl?: string;
  ticketSecret?: string;
  authTimeoutMs?: number;
  batchWindowMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  sessionSweepIntervalMs?: number;
  presenceTtlMs?: number;
  issueTeamBoundaryTtlMs?: number;
  maxIssueTeamBoundaries?: number;
  maxSubscriptions?: number;
  maxBufferedBytes?: number;
  messageBurst?: number;
  messagesPerSecond?: number;
}

export interface RealtimeStats {
  connections: number;
  subscriptions: number;
  redis: string;
}

export interface RealtimeSession {
  message(raw: string): void;
  pong(): void;
  closed(): void;
}

export interface RealtimeHub {
  accept(socket: RealtimeSocket): RealtimeSession;
  stats(): RealtimeStats;
  close(): Promise<void>;
}

const deltaEnvelopeSchema = z.union([
  z.array(z.unknown()).min(1),
  z.unknown().transform((action) => [action]),
]);

const redisPresenceMessageSchema = presenceMessageSchema.extend({
  audience: z
    .object({
      teamId: z.string().min(1).nullable(),
    })
    .optional(),
});

function issueScopeId(scope: string): string | null {
  if (!scope.startsWith('issue:')) return null;
  const issueId = scope.slice('issue:'.length);
  return issueId.length > 0 ? issueId : null;
}

function presenceWithinReach(
  connection: Connection,
  organizationId: string,
  scope: string,
  userId: string,
  issueAudienceTeamId: string | null,
): boolean {
  if (connection.principal.userId === userId) return false;
  if (!connection.matches([scope], organizationId)) return false;
  if (issueScopeId(scope) === null) return true;
  if (issueAudienceTeamId === null) return false;
  return (
    connection.principal.role === 'admin' ||
    connection.principal.teamIds.includes(issueAudienceTeamId)
  );
}

function issueTeamId(action: SyncAction): string | null {
  if (action.model !== 'issue') return null;
  const teamId = action.data['teamId'];
  return typeof teamId === 'string' && teamId.length > 0 ? teamId : null;
}

function issueTeamBoundaryKey(organizationId: string, issueId: string): string {
  return `${organizationId}|${issueId}`;
}

type IssueBinding =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'issue';
      readonly issueId: string;
      readonly claimedTeamIds: readonly string[];
      readonly departure: boolean;
    };

type BoundIssue = Extract<IssueBinding, { readonly kind: 'issue' }>;

type ActionAudience =
  | { readonly allowed: false }
  | { readonly allowed: true; readonly teamId: string | null };

type IssueDeletePreparation =
  | { readonly kind: 'none' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'hard-delete'; readonly sourceTeamId: string }
  | {
      readonly kind: 'departure';
      readonly sourceTeamId: string;
      readonly destinationTeamId: string;
    };

function issueBinding(action: SyncAction): IssueBinding {
  const issueIds = [
    ...new Set(
      action.scopes.map(issueScopeId).filter((issueId): issueId is string => issueId !== null),
    ),
  ];
  if (issueIds.length === 0) return { kind: 'none' };
  if (issueIds.length !== 1) return { kind: 'invalid' };
  const issueId = issueIds[0];
  if (issueId === undefined) return { kind: 'invalid' };
  if (action.model === 'issue' && issueId !== action.modelId) return { kind: 'invalid' };
  return {
    kind: 'issue',
    issueId,
    claimedTeamIds: action.scopes
      .filter((scope) => scope.startsWith('team:'))
      .map((scope) => scope.slice('team:'.length)),
    departure:
      action.model === 'issue' && action.action === 'delete' && action.data['departure'] === true,
  };
}

function pendingActionWithinReach(connection: Connection, action: SyncAction): boolean {
  if (connection.principal.role === 'admin') return true;
  if (action.model === 'issue') {
    const teamId = issueTeamId(action);
    return (
      teamId !== null &&
      action.scopes.includes(scopes.team(teamId)) &&
      connection.principal.teamIds.includes(teamId)
    );
  }
  if (!action.scopes.some((scope) => scope.startsWith('issue:'))) {
    return true;
  }
  return action.scopes.some(
    (scope) =>
      scope.startsWith('team:') &&
      connection.principal.teamIds.includes(scope.slice('team:'.length)),
  );
}

function audienceWithinReach(connection: Connection, audience: ActionAudience): boolean {
  if (!audience.allowed) return false;
  if (connection.principal.role === 'admin') return true;
  return audience.teamId === null || connection.principal.teamIds.includes(audience.teamId);
}

function declaredIssueAudience(action: SyncAction): ActionAudience {
  if (action.model !== 'issue') return { allowed: true, teamId: null };
  const teamId = issueTeamId(action);
  if (teamId === null || !action.scopes.includes(scopes.team(teamId))) {
    return { allowed: false };
  }
  return { allowed: true, teamId };
}

function issueDeclarationMatchesBinding(action: SyncAction, binding: IssueBinding): boolean {
  if (binding.kind !== 'issue' || action.model !== 'issue') return true;
  const teamId = issueTeamId(action);
  return teamId !== null && binding.claimedTeamIds.includes(teamId);
}

const CLOSE_CODES: Record<ConnectionRejection, number> = {
  unauthorized: UNAUTHORIZED_CLOSE_CODE,
  organization_forbidden: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
};

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function parseDeltaActions(payload: string): SyncAction[] | null {
  const envelope = deltaEnvelopeSchema.safeParse(parseJson(payload));
  if (!envelope.success) {
    logger.warn('discarded malformed delta', { channel: REDIS_DELTA_CHANNEL });
    return null;
  }
  const actions: SyncAction[] = [];
  for (const entry of envelope.data) {
    const parsed = syncActionSchema.safeParse(entry);
    if (!parsed.success) {
      logger.warn('discarded malformed delta action', { channel: REDIS_DELTA_CHANNEL });
      continue;
    }
    actions.push(parsed.data);
  }
  return actions;
}

export async function createRealtimeHub(options: RealtimeHubOptions = {}): Promise<RealtimeHub> {
  const limits = {
    batchWindowMs: options.batchWindowMs ?? DELTA_BATCH_WINDOW_MS,
    maxSubscriptions: options.maxSubscriptions ?? MAX_SUBSCRIPTIONS_PER_CONNECTION,
    maxBufferedBytes: options.maxBufferedBytes ?? MAX_BUFFERED_BYTES,
    messageBurst: options.messageBurst ?? MESSAGE_BURST,
    messagesPerSecond: options.messagesPerSecond ?? MESSAGES_PER_SECOND,
  };
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const sessionSweepIntervalMs = options.sessionSweepIntervalMs ?? SESSION_SWEEP_INTERVAL_MS;
  const presenceTtlMs = options.presenceTtlMs ?? PRESENCE_TTL_MS;
  const issueTeamBoundaryTtlMs = options.issueTeamBoundaryTtlMs ?? ISSUE_TEAM_BOUNDARY_TTL_MS;
  const maxIssueTeamBoundaries = options.maxIssueTeamBoundaries ?? MAX_ISSUE_TEAM_BOUNDARIES;
  const authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const redisUrl = options.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6380';
  const ticketSecret = options.ticketSecret ?? process.env['BETTER_AUTH_SECRET'] ?? '';
  if (ticketSecret.length === 0) {
    throw new Error('BETTER_AUTH_SECRET is required to verify realtime tickets.');
  }

  const connections = new Map<string, Connection>();
  const presence = new PresenceStore(presenceTtlMs);
  const issueTeamBoundaries = new IssueTeamBoundaries(
    issueTeamBoundaryTtlMs,
    maxIssueTeamBoundaries,
  );
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: 3 });

  function stats(): RealtimeStats {
    let subscriptions = 0;
    for (const connection of connections.values()) subscriptions += connection.subscriptionCount;
    return {
      connections: connections.size,
      subscriptions,
      redis: subscriber.status === 'ready' ? 'ready' : subscriber.status,
    };
  }

  async function revalidate(connection: Connection): Promise<void> {
    let valid = false;
    try {
      valid = await membershipStillValid(connection.principal);
    } catch (error: unknown) {
      logger.error('membership revalidation failed, closing to fail closed', {
        connectionId: connection.id,
        ...errorFields(error),
      });
    }
    if (valid) return;
    logger.info('closing connection for a removed member', {
      connectionId: connection.id,
      userId: connection.principal.userId,
      organizationId: connection.principal.organizationId,
    });
    connections.delete(connection.id);
    connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
  }

  async function revalidateSession(connection: Connection): Promise<void> {
    let valid = false;
    try {
      valid = await sessionStillValid(connection.principal.sessionId);
    } catch (error: unknown) {
      logger.error('session revalidation failed, closing to fail closed', {
        connectionId: connection.id,
        ...errorFields(error),
      });
    }
    if (valid) return;
    closeRevokedSession(connection);
  }

  function closeRevokedSession(connection: Connection): void {
    logger.info('closing connection for a revoked session', {
      connectionId: connection.id,
      userId: connection.principal.userId,
    });
    connections.delete(connection.id);
    connection.close(SESSION_REVOKED_CLOSE_CODE, 'session_revoked');
  }

  async function sweepSessions(): Promise<void> {
    const open = [...connections.values()];
    if (open.length === 0) return;
    const live = await liveSessionIds(open.map((connection) => connection.principal.sessionId));
    for (const connection of open) {
      if (live.has(connection.principal.sessionId)) continue;
      closeRevokedSession(connection);
    }
  }

  function revalidateSessionsFor(userId: string): void {
    for (const connection of connections.values()) {
      if (connection.principal.userId !== userId) continue;
      revalidateSession(connection).catch((error: unknown) => {
        logger.error('session revalidation failed', {
          connectionId: connection.id,
          ...errorFields(error),
        });
      });
    }
  }

  function closeOrganizationConnections(organizationId: string): void {
    for (const connection of connections.values()) {
      if (connection.organizationId !== organizationId) continue;
      connections.delete(connection.id);
      connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'organization_deleted');
    }
  }

  function deliverControl(payload: string): void {
    const parsed = controlMessageSchema.safeParse(parseJson(payload));
    if (!parsed.success) {
      logger.warn('discarded malformed control message', { channel: REDIS_CONTROL_CHANNEL });
      return;
    }
    if (parsed.data.type === 'session_revoked') {
      revalidateSessionsFor(parsed.data.userId);
      return;
    }
    closeOrganizationConnections(parsed.data.organizationId);
  }

  function mutableResourceScope(action: SyncAction): string | null {
    const docScope = action.scopes.find((entry) => entry.startsWith('doc:'));
    if (docScope !== undefined) return docScope;
    const projectScope = action.scopes.find((entry) => entry.startsWith('project:'));
    return projectScope ?? null;
  }

  function suspendMutableResourceReach(action: SyncAction): Connection[] {
    const scope = mutableResourceScope(action);
    if (scope === null) return [];
    const affected = [...connections.values()].filter(
      (connection) => connection.organizationId === action.organizationId,
    );
    for (const connection of affected) {
      connection.suspendDeltaFlush();
      connection.suspendAuthorization();
    }
    return affected;
  }

  async function revalidateMutableResourceScopes(
    action: SyncAction,
    affected: readonly Connection[],
  ): Promise<void> {
    const scope = mutableResourceScope(action);
    if (scope === null) return;
    await Promise.all(
      affected.map(async (connection) => {
        if (!connection.scopes.has(scope)) return;
        try {
          if (await authorizeScope(scope, connection.principal)) return;
          connection.removeScopes([scope]);
          logger.info('dropped a mutable resource scope the reader may no longer read', {
            connectionId: connection.id,
            scope,
          });
        } catch (error: unknown) {
          connection.removeScopes([scope]);
          logger.error('mutable resource scope revalidation failed, dropping to fail closed', {
            connectionId: connection.id,
            scope,
            ...errorFields(error),
          });
        }
      }),
    );
  }

  function isCurrentMutableResourceTombstone(action: SyncAction, pending: SyncAction): boolean {
    return (
      action === pending &&
      action.action === 'delete' &&
      (action.model === 'doc' || action.model === 'project')
    );
  }

  function finishMutableResourceReach(action: SyncAction, affected: readonly Connection[]): void {
    for (const connection of affected) {
      if (connections.get(connection.id) === connection) {
        connection.resumeDeltaFlush(
          (pending) =>
            isCurrentMutableResourceTombstone(action, pending) ||
            connection.matches(pending.scopes, pending.organizationId),
        );
      }
      connection.resumeAuthorization();
    }
  }

  async function revalidateReach(connection: Connection): Promise<void> {
    const next = await refreshedPrincipal(connection.principal);
    if (next === null) {
      connections.delete(connection.id);
      connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
      return;
    }
    connection.adoptPrincipal(next);
    const dropped: string[] = [];
    for (const scope of connection.heldScopes()) {
      if (await authorizeScope(scope, next)) continue;
      dropped.push(scope);
    }
    if (dropped.length === 0) return;
    connection.removeScopes(dropped);
    logger.info('dropped scopes the reader may no longer reach', {
      connectionId: connection.id,
      dropped,
    });
  }

  async function revalidateMembershipReach(action: SyncAction): Promise<void> {
    if (action.model !== 'team_member' && action.model !== 'member') return;
    if (action.model === 'member' && action.action === 'delete') return;
    const affected = [...connections.values()].filter(
      (connection) => connection.organizationId === action.organizationId,
    );
    await Promise.all(
      affected.map(async (connection) => {
        try {
          await revalidateReach(connection);
        } catch (error: unknown) {
          connections.delete(connection.id);
          connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
          logger.error('reach revalidation failed, closing to fail closed', {
            connectionId: connection.id,
            ...errorFields(error),
          });
        }
      }),
    );
  }

  async function revalidateAffected(action: SyncAction): Promise<void> {
    await revalidateMembershipReach(action);
    if (action.model !== 'member' || action.action !== 'delete') return;
    const removed = memberDeleteSchema.safeParse(action.data);
    if (!removed.success) throw new Error('member removal payload cannot be revalidated');
    const affected = [...connections.values()].filter(
      (connection) =>
        connection.organizationId === action.organizationId &&
        connection.principal.userId === removed.data.userId,
    );
    await Promise.all(
      affected.map(async (connection) => {
        try {
          await revalidate(connection);
        } catch (error: unknown) {
          connections.delete(connection.id);
          connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
          logger.error('membership revalidation failed', {
            connectionId: connection.id,
            ...errorFields(error),
          });
        }
      }),
    );
  }

  function affectsMembershipReach(action: SyncAction): boolean {
    return action.model === 'team_member' || action.model === 'member';
  }

  function suspendMembershipDeltaFlush(action: SyncAction): Connection[] {
    if (!affectsMembershipReach(action)) return [];
    const affected = [...connections.values()].filter(
      (connection) => connection.organizationId === action.organizationId,
    );
    for (const connection of affected) {
      connection.suspendDeltaFlush();
      connection.suspendAuthorization();
    }
    return affected;
  }

  function finishMembershipDeltaFlush(
    action: SyncAction,
    affected: readonly Connection[],
    revalidated: boolean,
  ): void {
    if (affected.length === 0) return;
    for (const connection of affected) {
      if (connections.get(connection.id) !== connection) {
        connection.resumeAuthorization();
        continue;
      }
      if (!revalidated) {
        connections.delete(connection.id);
        connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
        connection.resumeAuthorization();
        continue;
      }
      connection.resumeDeltaFlush(
        (pending) =>
          pendingActionWithinReach(connection, pending) &&
          connection.matches(pending.scopes, pending.organizationId),
      );
      connection.resumeAuthorization();
    }
    if (revalidated) return;
    logger.error('membership delta processing failed, closing to fail closed', {
      organizationId: action.organizationId,
    });
  }

  function affectsIssueMoveReach(action: SyncAction): boolean {
    if (action.model !== 'issue') return false;
    return (
      action.action === 'delete' ||
      action.data['teamChanged'] === true ||
      action.data['departure'] === true
    );
  }

  function suspendIssueMoveReach(action: SyncAction): Connection[] {
    if (!affectsIssueMoveReach(action)) return [];
    const affected = [...connections.values()].filter(
      (connection) => connection.organizationId === action.organizationId,
    );
    for (const connection of affected) {
      connection.suspendDeltaFlush();
      connection.suspendAuthorization();
    }
    return affected;
  }

  function pendingIssueActionWithinReach(connection: Connection, action: SyncAction): boolean {
    const binding = issueBinding(action);
    if (binding.kind === 'invalid') return false;
    if (binding.kind === 'none') {
      return (
        pendingActionWithinReach(connection, action) &&
        connection.matches(action.scopes, action.organizationId)
      );
    }
    const boundary = issueTeamBoundaries.get(
      issueTeamBoundaryKey(action.organizationId, binding.issueId),
    );
    if (boundary === undefined) {
      return (
        pendingActionWithinReach(connection, action) &&
        connection.matches(action.scopes, action.organizationId)
      );
    }
    if (boundary.moveSyncId !== null && action.syncId < boundary.moveSyncId) return false;
    if (binding.departure) return pendingActionWithinReach(connection, action);
    return (
      audienceWithinReach(connection, issueAudienceAtBoundary(action, binding, boundary)) &&
      connection.matches(action.scopes, action.organizationId)
    );
  }

  function isCurrentIssueTombstone(action: SyncAction, pending: SyncAction): boolean {
    return action === pending && action.model === 'issue' && action.action === 'delete';
  }

  function finishIssueMoveReach(action: SyncAction, affected: readonly Connection[]): void {
    for (const connection of affected) {
      if (connections.get(connection.id) === connection) {
        connection.resumeDeltaFlush(
          (pending) =>
            isCurrentIssueTombstone(action, pending) ||
            pendingIssueActionWithinReach(connection, pending),
        );
      }
      connection.resumeAuthorization();
    }
  }

  function dropIssueScopeOutsideTeam(action: SyncAction, destinationTeamId: string | null): void {
    const issueScope = scopes.issue(action.modelId);
    for (const connection of connections.values()) {
      if (connection.organizationId !== action.organizationId) continue;
      if (!connection.scopes.has(issueScope) || connection.principal.role === 'admin') continue;
      if (destinationTeamId !== null && connection.principal.teamIds.includes(destinationTeamId)) {
        continue;
      }
      connection.removeScopes([issueScope]);
    }
  }

  async function prepareIssueMoveArrival(action: SyncAction): Promise<boolean> {
    if (action.model !== 'issue' || action.action === 'delete') return true;
    if (action.data['teamChanged'] !== true) return true;
    const destinationTeamId = issueTeamId(action);
    if (destinationTeamId === null) return false;
    const boundaryKey = issueTeamBoundaryKey(action.organizationId, action.modelId);
    const known = issueTeamBoundaries.get(boundaryKey);
    if (known !== undefined && known.moveSyncId !== null && known.moveSyncId > action.syncId) {
      return false;
    }
    const current = await loadAuthoritativeIssueReach(
      action,
      'issue move validation failed, preserving existing reach',
    );
    if (
      current === null ||
      current.teamId !== destinationTeamId ||
      action.syncId !== current.syncId
    ) {
      return false;
    }
    issueTeamBoundaries.rememberMove(boundaryKey, action.syncId, destinationTeamId);
    presence.move(scopes.issue(action.modelId), destinationTeamId);
    dropIssueScopeOutsideTeam(action, destinationTeamId);
    return true;
  }

  async function loadAuthoritativeIssueReach(
    action: SyncAction,
    failureMessage: string,
  ): Promise<Awaited<ReturnType<typeof issueReachInOrganization>>> {
    try {
      return await issueReachInOrganization(action.modelId, action.organizationId);
    } catch (error: unknown) {
      logger.error(failureMessage, {
        organizationId: action.organizationId,
        issueId: action.modelId,
        ...errorFields(error),
      });
      return null;
    }
  }

  async function prepareMoveDeparture(
    action: SyncAction,
    sourceTeamId: string,
  ): Promise<IssueDeletePreparation> {
    const boundaryKey = issueTeamBoundaryKey(action.organizationId, action.modelId);
    let current: Awaited<ReturnType<typeof issueReachInOrganization>>;
    try {
      current = await issueReachInOrganization(action.modelId, action.organizationId);
    } catch (error: unknown) {
      logger.error('issue departure validation failed, preserving existing reach', {
        organizationId: action.organizationId,
        issueId: action.modelId,
        ...errorFields(error),
      });
      return { kind: 'rejected' };
    }
    if (current === null) return { kind: 'hard-delete', sourceTeamId };
    if (current.syncId < action.syncId) {
      return { kind: 'rejected' };
    }
    issueTeamBoundaries.rememberAuthoritative(boundaryKey, action.syncId, current.teamId);
    if (current.teamId === sourceTeamId) return { kind: 'rejected' };
    return { kind: 'departure', sourceTeamId, destinationTeamId: current.teamId };
  }

  async function prepareHardIssueDelete(
    action: SyncAction,
    sourceTeamId: string,
  ): Promise<IssueDeletePreparation> {
    try {
      const current = await issueReachInOrganization(action.modelId, action.organizationId);
      return current === null ? { kind: 'hard-delete', sourceTeamId } : { kind: 'rejected' };
    } catch (error: unknown) {
      logger.error('hard issue delete validation failed, preserving existing reach', {
        organizationId: action.organizationId,
        issueId: action.modelId,
        ...errorFields(error),
      });
      return { kind: 'rejected' };
    }
  }

  async function prepareIssueDelete(action: SyncAction): Promise<IssueDeletePreparation> {
    if (action.model !== 'issue' || action.action !== 'delete') return { kind: 'none' };
    const sourceTeamId = issueTeamId(action);
    if (sourceTeamId === null || !action.scopes.includes(scopes.team(sourceTeamId))) {
      return { kind: 'rejected' };
    }
    return action.data['departure'] === true
      ? await prepareMoveDeparture(action, sourceTeamId)
      : await prepareHardIssueDelete(action, sourceTeamId);
  }

  function clearDeletedIssueReach(action: SyncAction): void {
    const issueScope = scopes.issue(action.modelId);
    issueTeamBoundaries.delete(issueTeamBoundaryKey(action.organizationId, action.modelId));
    presence.move(issueScope, null);
    for (const connection of connections.values()) {
      if (connection.organizationId === action.organizationId) {
        connection.removeScopes([issueScope]);
      }
    }
  }

  function settleIssueDelete(action: SyncAction, preparation: IssueDeletePreparation): void {
    if (preparation.kind === 'hard-delete') {
      clearDeletedIssueReach(action);
      return;
    }
    if (preparation.kind !== 'departure') return;
    presence.move(scopes.issue(action.modelId), preparation.destinationTeamId);
    dropIssueScopeOutsideTeam(action, preparation.destinationTeamId);
  }

  async function loadIssueTeamBoundary(
    action: SyncAction,
    binding: BoundIssue,
  ): Promise<IssueTeamBoundary | null> {
    const boundaryKey = issueTeamBoundaryKey(action.organizationId, binding.issueId);
    const cached = issueTeamBoundaries.get(boundaryKey);
    if (cached !== undefined) return cached;
    try {
      const teamId = await issueTeamIdInOrganization(binding.issueId, action.organizationId);
      if (teamId === null) return null;
      issueTeamBoundaries.rememberCurrent(boundaryKey, teamId);
      return { teamId, moveSyncId: null };
    } catch (error: unknown) {
      logger.error('issue audience lookup failed, discarding action to fail closed', {
        organizationId: action.organizationId,
        issueId: binding.issueId,
        ...errorFields(error),
      });
      return null;
    }
  }

  function issueAudienceAtBoundary(
    action: SyncAction,
    binding: BoundIssue,
    boundary: IssueTeamBoundary,
  ): ActionAudience {
    if (boundary.moveSyncId !== null && action.syncId < boundary.moveSyncId) {
      return { allowed: false };
    }
    if (!binding.claimedTeamIds.includes(boundary.teamId)) return { allowed: false };
    if (action.model === 'issue' && issueTeamId(action) !== boundary.teamId) {
      return { allowed: false };
    }
    return { allowed: true, teamId: boundary.teamId };
  }

  function departureAudience(
    action: SyncAction,
    boundary: IssueTeamBoundary | undefined,
  ): ActionAudience {
    if (
      boundary !== undefined &&
      boundary.moveSyncId !== null &&
      action.syncId < boundary.moveSyncId
    ) {
      return { allowed: false };
    }
    return declaredIssueAudience(action);
  }

  async function resolveActionAudience(action: SyncAction): Promise<ActionAudience> {
    const binding = issueBinding(action);
    if (binding.kind === 'invalid') return { allowed: false };
    if (binding.kind === 'none') return declaredIssueAudience(action);
    if (!issueDeclarationMatchesBinding(action, binding)) return { allowed: false };
    const boundaryKey = issueTeamBoundaryKey(action.organizationId, binding.issueId);
    if (binding.departure) {
      return departureAudience(action, issueTeamBoundaries.get(boundaryKey));
    }
    const boundary = await loadIssueTeamBoundary(action, binding);
    return boundary === null
      ? { allowed: false }
      : issueAudienceAtBoundary(action, binding, boundary);
  }

  function queueActionForAudience(action: SyncAction, audience: ActionAudience): void {
    for (const connection of connections.values()) {
      if (!audienceWithinReach(connection, audience)) continue;
      if (connection.matches(action.scopes, action.organizationId)) {
        connection.queueDelta(action);
      }
    }
  }

  async function resolvePreparedActionAudience(
    action: SyncAction,
    moveArrivalValid: boolean,
    issueDelete: IssueDeletePreparation,
  ): Promise<ActionAudience> {
    if (!moveArrivalValid || issueDelete.kind === 'rejected') return { allowed: false };
    if (issueDelete.kind === 'hard-delete') {
      return { allowed: true, teamId: issueDelete.sourceTeamId };
    }
    if (issueDelete.kind === 'departure') {
      return { allowed: true, teamId: issueDelete.sourceTeamId };
    }
    return await resolveActionAudience(action);
  }

  async function deliverDelta(payload: string): Promise<void> {
    const actions = parseDeltaActions(payload);
    if (actions === null) return;
    for (const action of actions) {
      const membershipAffected = suspendMembershipDeltaFlush(action);
      const resourceAffected = suspendMutableResourceReach(action);
      const issueMoveAffected = suspendIssueMoveReach(action);
      let revalidated = false;
      try {
        const moveArrivalValid = await prepareIssueMoveArrival(action);
        const issueDelete = await prepareIssueDelete(action);
        const audience = await resolvePreparedActionAudience(action, moveArrivalValid, issueDelete);
        queueActionForAudience(action, audience);
        settleIssueDelete(action, issueDelete);
        await revalidateMutableResourceScopes(action, resourceAffected);
        await revalidateAffected(action);
        revalidated = true;
      } catch (error: unknown) {
        logger.error('delta action processing failed', {
          organizationId: action.organizationId,
          model: action.model,
          modelId: action.modelId,
          ...errorFields(error),
        });
      } finally {
        finishMutableResourceReach(action, resourceAffected);
        finishIssueMoveReach(action, issueMoveAffected);
        finishMembershipDeltaFlush(action, membershipAffected, revalidated);
      }
    }
  }

  function deliverPresence(payload: string): void {
    const parsed = redisPresenceMessageSchema.safeParse(parseJson(payload));
    if (!parsed.success) {
      logger.warn('discarded malformed presence', { channel: REDIS_PRESENCE_CHANNEL });
      return;
    }
    const { audience, ...message } = parsed.data;
    if (!presence.record(message, audience ?? null)) return;
    const issueId = issueScopeId(message.scope);
    const issueAudienceTeamId = issueId === null ? null : (audience?.teamId ?? null);
    for (const connection of connections.values()) {
      if (
        !presenceWithinReach(
          connection,
          message.organizationId,
          message.scope,
          message.userId,
          issueAudienceTeamId,
        )
      ) {
        continue;
      }
      connection.send({ type: 'presence', messages: [message] });
    }
  }

  async function partitionScopes(
    connection: Connection,
    requested: readonly string[],
  ): Promise<{ accepted: string[]; denied: string[] }> {
    const accepted: string[] = [];
    const denied: string[] = [];
    for (const scope of requested) {
      if (connection.scopes.has(scope)) {
        accepted.push(scope);
        continue;
      }
      if (await authorizeScope(scope, connection.principal)) accepted.push(scope);
      else denied.push(scope);
    }
    return { accepted, denied };
  }

  function sendSubscriptionResult(
    connection: Connection,
    accepted: readonly string[],
    denied: readonly string[],
  ): void {
    const overflow = connection.addScopes(accepted);
    connection.send({
      type: 'subscribed',
      scopes: [...connection.scopes],
      denied: [...denied, ...overflow],
    });
    for (const scope of accepted) {
      if (!connection.scopes.has(scope)) continue;
      const messages = presence
        .snapshot(scope, {
          admin: connection.principal.role === 'admin',
          teamIds: connection.principal.teamIds,
        })
        .filter((message) => message.userId !== connection.principal.userId);
      if (messages.length > 0) connection.send({ type: 'presence', messages });
    }
  }

  async function handleSubscribe(connection: Connection, requested: string[]): Promise<void> {
    while (connections.get(connection.id) === connection) {
      const generation = await connection.waitForAuthorization();
      if (connections.get(connection.id) !== connection) return;
      const { accepted, denied } = await partitionScopes(connection, requested);
      if (connections.get(connection.id) !== connection) return;
      if (!connection.authorizationIsCurrent(generation)) continue;
      sendSubscriptionResult(connection, accepted, denied);
      return;
    }
  }

  interface PresenceAuthorization {
    readonly allowed: boolean;
    readonly held: boolean;
    readonly issueTeamId: string | null;
  }

  async function authorizePresence(
    connection: Connection,
    scope: string,
  ): Promise<PresenceAuthorization> {
    const held = connection.scopes.has(scope);
    const issueId = issueScopeId(scope);
    const issueAudienceTeamId =
      issueId === null ? null : await authorizedIssueTeamId(issueId, connection.principal);
    const allowed =
      issueId === null
        ? held || (await authorizeScope(scope, connection.principal))
        : issueAudienceTeamId !== null;
    return { allowed, held, issueTeamId: issueAudienceTeamId };
  }

  async function publishPresence(
    connection: Connection,
    scope: string,
    kind: PresenceKind,
    issueTeamId: string | null,
  ): Promise<void> {
    await publisher.publish(
      REDIS_PRESENCE_CHANNEL,
      JSON.stringify({
        organizationId: connection.organizationId,
        scope,
        kind,
        userId: connection.principal.userId,
        name: connection.principal.name,
        image: connection.principal.image,
        at: new Date().toISOString(),
        audience: { teamId: issueTeamId },
      }),
    );
  }

  async function handlePresence(
    connection: Connection,
    scope: string,
    kind: PresenceKind,
  ): Promise<void> {
    while (connections.get(connection.id) === connection) {
      const generation = await connection.waitForAuthorization();
      if (connections.get(connection.id) !== connection) return;
      const authorization = await authorizePresence(connection, scope);
      if (connections.get(connection.id) !== connection) return;
      if (!connection.authorizationIsCurrent(generation)) continue;
      if (!authorization.allowed) {
        if (authorization.held) connection.removeScopes([scope]);
        connection.send({ type: 'error', code: 'forbidden_scope', message: 'Scope not allowed.' });
        return;
      }
      await publishPresence(connection, scope, kind, authorization.issueTeamId);
      return;
    }
  }

  async function handleMessage(connection: Connection, raw: string): Promise<void> {
    connection.lastSeenAt = Date.now();
    if (!connection.takeToken()) {
      if (connection.announceThrottled()) {
        connection.send({
          type: 'error',
          code: 'rate_limited',
          message: 'Too many messages, slow down.',
        });
      }
      return;
    }
    connection.clearThrottle();
    const parsed = clientMessageSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      connection.send({
        type: 'error',
        code: 'invalid_message',
        message: 'Message did not match the client protocol.',
      });
      return;
    }
    const message = parsed.data;
    if (message.type === 'ping') {
      connection.send({ type: 'pong', at: new Date().toISOString() });
      return;
    }
    if (message.type === 'unsubscribe') {
      connection.removeScopes(message.scopes);
      connection.send({ type: 'subscribed', scopes: [...connection.scopes], denied: [] });
      return;
    }
    if (message.type === 'subscribe') {
      if (message.since !== undefined) connection.advanceWatermark(message.since);
      await handleSubscribe(connection, message.scopes);
      return;
    }
    await handlePresence(connection, message.scope, message.kind);
  }

  function clearAuthTimer(state: SocketState): void {
    if (state.authTimer !== undefined) {
      clearTimeout(state.authTimer);
      state.authTimer = undefined;
    }
  }

  async function authenticate(
    socket: RealtimeSocket,
    state: SocketState,
    raw: string,
  ): Promise<void> {
    if (state.connection !== null || state.authenticating) return;
    const payload = readTicketFrame(raw, ticketSecret);
    if (payload === null) {
      socket.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized');
      return;
    }
    state.authenticating = true;
    const authenticated = await authenticateTicket(payload);
    if (socket.readyState !== SOCKET_OPEN) return;
    if (!authenticated.ok) {
      socket.close(CLOSE_CODES[authenticated.reason], authenticated.reason);
      return;
    }
    clearAuthTimer(state);
    const connection = new Connection(randomUUID(), socket, authenticated.principal, limits);
    state.connection = connection;
    connections.set(connection.id, connection);
    connection.send({
      type: 'ready',
      connectionId: connection.id,
      userId: authenticated.principal.userId,
      organizationId: authenticated.principal.organizationId,
      scopes: [],
    });
    logger.info('connection ready', {
      connectionId: connection.id,
      userId: authenticated.principal.userId,
      organizationId: authenticated.principal.organizationId,
    });
  }

  function accept(socket: RealtimeSocket): RealtimeSession {
    const state: SocketState = { connection: null, authenticating: false, authTimer: undefined };
    state.authTimer = setTimeout(() => {
      state.authTimer = undefined;
      if (state.connection === null) socket.close(UNAUTHORIZED_CLOSE_CODE, 'auth_timeout');
    }, authTimeoutMs);
    state.authTimer.unref();

    return {
      message(raw: string): void {
        const connection = state.connection;
        if (connection === null) {
          authenticate(socket, state, raw).catch((error: unknown) => {
            logger.error('authentication failed', errorFields(error));
            if (socket.readyState === SOCKET_OPEN) {
              socket.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized');
            }
          });
          return;
        }
        handleMessage(connection, raw).catch((error: unknown) => {
          logger.error('message handling failed', {
            connectionId: connection.id,
            ...errorFields(error),
          });
        });
      },
      pong(): void {
        if (state.connection === null) return;
        state.connection.lastSeenAt = Date.now();
      },
      closed(): void {
        clearAuthTimer(state);
        if (state.connection === null) return;
        connections.delete(state.connection.id);
      },
    };
  }

  let closing = false;
  let orderedDelivery = Promise.resolve();

  subscriber.on('message', (channel: string, message: string) => {
    if (channel === REDIS_DELTA_CHANNEL || channel === REDIS_PRESENCE_CHANNEL) {
      orderedDelivery = orderedDelivery
        .then(async () => {
          if (channel === REDIS_DELTA_CHANNEL) await deliverDelta(message);
          else deliverPresence(message);
        })
        .catch((error: unknown) => {
          logger.error('ordered realtime delivery failed', errorFields(error));
        });
      return;
    }
    if (channel === REDIS_CONTROL_CHANNEL) deliverControl(message);
  });
  await subscriber.subscribe(REDIS_DELTA_CHANNEL, REDIS_PRESENCE_CHANNEL, REDIS_CONTROL_CHANNEL);

  subscriber.on('error', (error: Error): void => {
    if (!closing) logger.error('redis subscriber error', errorFields(error));
  });
  publisher.on('error', (error: Error): void => {
    if (!closing) logger.error('redis publisher error', errorFields(error));
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (now - connection.lastSeenAt > heartbeatTimeoutMs) {
        logger.warn('terminating stale connection', { connectionId: connection.id });
        connections.delete(connection.id);
        connection.terminate();
        continue;
      }
      connection.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  const sweeper = setInterval(
    () => {
      presence.sweep();
      issueTeamBoundaries.sweep();
    },
    Math.max(1_000, Math.min(presenceTtlMs, issueTeamBoundaryTtlMs) / 3),
  );
  sweeper.unref();

  const sessionSweeper = setInterval(() => {
    sweepSessions().catch((error: unknown) => {
      logger.error('session sweep failed', errorFields(error));
    });
  }, sessionSweepIntervalMs);
  sessionSweeper.unref();

  async function close(): Promise<void> {
    closing = true;
    clearInterval(heartbeat);
    clearInterval(sweeper);
    clearInterval(sessionSweeper);
    for (const connection of connections.values()) connection.close(1001, 'server shutting down');
    connections.clear();
    subscriber.disconnect();
    publisher.disconnect();
    await orderedDelivery;
  }

  return { accept, stats, close };
}
