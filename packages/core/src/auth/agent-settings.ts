import { and, db, desc, eq, inArray, isNull, schema } from '@orbit/db';
import { agentIdentityAuthority, can, type Principal } from '@orbit/shared/policy';
import { findPrincipal } from '../org/member-service.ts';
import { agentLifecycle } from './agent-identity-service.ts';

export interface AgentSettingsView {
  readonly id: string;
  readonly name: string;
  readonly avatar: string | null;
  readonly lifecycle: 'active' | 'disabled' | 'deleted';
  readonly connection: 'connected' | 'disconnected';
  readonly owner: {
    readonly id: string | null;
    readonly name: string;
    readonly avatar: string | null;
  };
  readonly client: { readonly id: string; readonly name: string };
  readonly grant: { readonly id: string; readonly scopes: string[] } | null;
  readonly effectivePermissions: string[];
  readonly ownerLocked: boolean;
  readonly adminLocked: boolean;
  readonly lastUsedAt: string | null;
  readonly lastActedAt: string | null;
  readonly openIssueCount: number;
  readonly recentActivity: readonly {
    id: string;
    issueId: string;
    identifier: string;
    field: string;
    createdAt: string;
  }[];
  readonly viewerAuthority: 'owner' | 'admin' | null;
}

async function agentViews(principal: Principal, ownerOnly: boolean): Promise<AgentSettingsView[]> {
  const identities = await db
    .select()
    .from(schema.agentIdentity)
    .where(
      ownerOnly
        ? and(
            eq(schema.agentIdentity.organizationId, principal.organizationId),
            eq(schema.agentIdentity.ownerUserId, principal.userId),
          )
        : eq(schema.agentIdentity.organizationId, principal.organizationId),
    )
    .orderBy(desc(schema.agentIdentity.createdAt));
  if (identities.length === 0) return [];
  const grants = await db
    .select()
    .from(schema.mcpGrant)
    .where(
      and(
        inArray(
          schema.mcpGrant.agentIdentityId,
          identities.map((identity) => identity.id),
        ),
        isNull(schema.mcpGrant.revokedAt),
      ),
    );
  const clients = await db
    .select({ id: schema.oauthApplication.clientId, name: schema.oauthApplication.name })
    .from(schema.oauthApplication)
    .where(
      inArray(schema.oauthApplication.clientId, [
        ...new Set(identities.map((identity) => identity.clientId)),
      ]),
    );
  const ownerIds = identities.flatMap((identity) =>
    identity.ownerUserId === null ? [] : [identity.ownerUserId],
  );
  const owners =
    ownerIds.length === 0
      ? []
      : await db
          .select({ id: schema.user.id, name: schema.user.name, avatar: schema.user.image })
          .from(schema.user)
          .where(inArray(schema.user.id, ownerIds));
  const grantByAgent = new Map(grants.map((grant) => [grant.agentIdentityId, grant]));
  const clientById = new Map(clients.map((client) => [client.id, client.name]));
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
  return await Promise.all(
    identities.map(
      async (identity) =>
        await agentView(
          principal,
          identity,
          grantByAgent.get(identity.id),
          clientById.get(identity.clientId),
          identity.ownerUserId === null ? undefined : ownerById.get(identity.ownerUserId),
        ),
    ),
  );
}

function effectiveAgentPermissions(owner: Principal | null, scopes: readonly string[]): string[] {
  if (owner === null) return [];
  return [
    ...(scopes.includes('orbit.read') && can(owner, 'issue:read') ? ['issue:read'] : []),
    ...(scopes.includes('orbit.write')
      ? (['issue:create', 'issue:update', 'issue:delete'] as const).filter((permission) =>
          can(owner, permission),
        )
      : []),
  ];
}

async function visibleAgentIssueSummary(principal: Principal, identityId: string) {
  const visibleTeams = principal.role === 'admin' ? null : principal.teamIds;
  const teamFilter =
    visibleTeams === null
      ? undefined
      : inArray(schema.issue.teamId, visibleTeams.length === 0 ? [''] : [...visibleTeams]);
  const [issues, activity] = await Promise.all([
    db
      .select({ id: schema.issue.id })
      .from(schema.issue)
      .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
      .where(
        and(
          eq(schema.issue.assigneeAgentId, identityId),
          isNull(schema.issue.archivedAt),
          inArray(schema.workflowState.category, [
            'triage',
            'backlog',
            'unstarted',
            'started',
            'review',
          ]),
          teamFilter,
        ),
      ),
    db
      .select({
        id: schema.issueActivity.id,
        issueId: schema.issue.id,
        identifier: schema.issue.identifier,
        field: schema.issueActivity.field,
        createdAt: schema.issueActivity.createdAt,
      })
      .from(schema.issueActivity)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.issueActivity.issueId))
      .where(
        and(
          eq(schema.issueActivity.actorType, 'agent'),
          eq(schema.issueActivity.actorId, identityId),
          teamFilter,
        ),
      )
      .orderBy(desc(schema.issueActivity.createdAt))
      .limit(5),
  ]);
  return {
    openIssueCount: issues.length,
    recentActivity: activity.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

async function agentView(
  principal: Principal,
  identity: typeof schema.agentIdentity.$inferSelect,
  grant: typeof schema.mcpGrant.$inferSelect | undefined,
  clientName: string | undefined,
  owner: { readonly name: string; readonly avatar: string | null } | undefined,
): Promise<AgentSettingsView> {
  const ownerPrincipal =
    identity.ownerUserId === null
      ? null
      : await findPrincipal(identity.ownerUserId, identity.organizationId);
  const scopes = grant?.scopes.split(/\s+/).filter(Boolean) ?? [];
  return {
    id: identity.id,
    name: identity.name,
    avatar: identity.avatar,
    lifecycle: agentLifecycle(identity),
    connection: grant === undefined ? 'disconnected' : 'connected',
    owner: {
      id: identity.ownerUserId,
      name: owner?.name ?? identity.ownerNameSnapshot,
      avatar: owner?.avatar ?? null,
    },
    client: { id: identity.clientId, name: clientName ?? identity.clientNameSnapshot },
    grant: grant === undefined ? null : { id: grant.id, scopes },
    effectivePermissions: effectiveAgentPermissions(ownerPrincipal, scopes),
    ownerLocked: identity.ownerDisabledAt !== null,
    adminLocked: identity.adminDisabledAt !== null,
    lastUsedAt: grant?.lastUsedAt?.toISOString() ?? null,
    lastActedAt: identity.lastActedAt?.toISOString() ?? null,
    ...(await visibleAgentIssueSummary(principal, identity.id)),
    viewerAuthority: agentIdentityAuthority(principal, identity),
  };
}

export async function listAgentSettings(principal: Principal): Promise<{
  readonly yourAgents: AgentSettingsView[];
  readonly workspaceAgents: AgentSettingsView[];
  readonly activeQuotaUsed: number;
  readonly activeQuotaLimit: number;
}> {
  const yourAgents = await agentViews(principal, true);
  const workspaceAgents =
    principal.role === 'admin'
      ? (await agentViews(principal, false)).filter((agent) => agent.owner.id !== principal.userId)
      : [];
  return {
    yourAgents,
    workspaceAgents,
    activeQuotaUsed: yourAgents.filter((agent) => agent.lifecycle === 'active').length,
    activeQuotaLimit: 2,
  };
}
