import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './org.ts';

export const oauthApplication = pgTable(
  'oauth_application',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    icon: text('icon'),
    metadata: text('metadata'),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    redirectUrls: text('redirect_urls').notNull(),
    type: text('type').notNull(),
    disabled: boolean('disabled').notNull().default(false),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('oauth_application_user_idx').on(table.userId)],
);

export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    accessToken: text('access_token').notNull().unique(),
    refreshToken: text('refresh_token').notNull().unique(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    mcpGrantId: text('mcp_grant_id').references(() => mcpGrant.id, { onDelete: 'restrict' }),
    scopes: text('scopes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('oauth_access_token_client_idx').on(table.clientId),
    index('oauth_access_token_user_idx').on(table.userId),
    index('oauth_access_token_mcp_grant_idx').on(table.mcpGrantId),
  ],
);

export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    consentGiven: boolean('consent_given').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('oauth_consent_client_idx').on(table.clientId),
    index('oauth_consent_user_idx').on(table.userId),
  ],
);

export const agentIdentity = pgTable(
  'agent_identity',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    ownerNameSnapshot: text('owner_name_snapshot').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'restrict' }),
    clientNameSnapshot: text('client_name_snapshot').notNull(),
    name: text('name').notNull(),
    avatar: text('avatar'),
    ownerDisabledAt: timestamp('owner_disabled_at', { withTimezone: true }),
    ownerDisabledByUserId: text('owner_disabled_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ownerDisabledActorIdSnapshot: text('owner_disabled_actor_id_snapshot'),
    ownerResumedAt: timestamp('owner_resumed_at', { withTimezone: true }),
    ownerResumedByUserId: text('owner_resumed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ownerResumedActorIdSnapshot: text('owner_resumed_actor_id_snapshot'),
    adminDisabledAt: timestamp('admin_disabled_at', { withTimezone: true }),
    adminDisabledByUserId: text('admin_disabled_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    adminDisabledActorIdSnapshot: text('admin_disabled_actor_id_snapshot'),
    adminResumedAt: timestamp('admin_resumed_at', { withTimezone: true }),
    adminResumedByUserId: text('admin_resumed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    adminResumedActorIdSnapshot: text('admin_resumed_actor_id_snapshot'),
    connectionRevokedAt: timestamp('connection_revoked_at', { withTimezone: true }),
    connectionRevokedByUserId: text('connection_revoked_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    connectionRevokedActorIdSnapshot: text('connection_revoked_actor_id_snapshot'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: text('deleted_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    deletedActorIdSnapshot: text('deleted_actor_id_snapshot'),
    deletedReason: text('deleted_reason'),
    lastActedAt: timestamp('last_acted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_identity_organization_id_id_unique').on(table.organizationId, table.id),
    uniqueIndex('agent_identity_grant_binding_unique').on(
      table.organizationId,
      table.ownerUserId,
      table.clientId,
      table.id,
    ),
    index('agent_identity_org_owner_idx').on(table.organizationId, table.ownerUserId),
    check(
      'agent_identity_owner_deleted_check',
      sql`${table.ownerUserId} is not null or ${table.deletedAt} is not null`,
    ),
  ],
);

export const mcpGrant = pgTable(
  'mcp_grant',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'restrict' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    agentIdentityId: text('agent_identity_id').references(() => agentIdentity.id, {
      onDelete: 'restrict',
    }),
    principalNameSnapshot: text('principal_name_snapshot').notNull(),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    index('mcp_grant_user_idx').on(table.userId),
    check(
      'mcp_grant_active_binding_check',
      sql`(${table.revokedAt} is null and ${table.agentIdentityId} is not null and ${table.userId} is not null) or (${table.revokedAt} is not null and (${table.agentIdentityId} is not null or (${table.revokeReason} is not null and ${table.revokeReason} = 'agent_identity_required')))`,
    ),
    index('mcp_grant_agent_identity_idx').on(table.agentIdentityId),
    uniqueIndex('mcp_grant_active_agent_unique')
      .on(table.agentIdentityId)
      .where(sql`${table.revokedAt} is null and ${table.agentIdentityId} is not null`),
    foreignKey({
      name: 'mcp_grant_organization_agent_identity_fk',
      columns: [table.organizationId, table.agentIdentityId],
      foreignColumns: [agentIdentity.organizationId, agentIdentity.id],
    }),
    foreignKey({
      name: 'mcp_grant_agent_binding_fk',
      columns: [table.organizationId, table.userId, table.clientId, table.agentIdentityId],
      foreignColumns: [
        agentIdentity.organizationId,
        agentIdentity.ownerUserId,
        agentIdentity.clientId,
        agentIdentity.id,
      ],
    }),
  ],
);
