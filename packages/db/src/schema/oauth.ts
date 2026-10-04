import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './org.ts';

export const agentIdentity = pgTable(
  'agent_identity',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    clientId: text('client_id').references(() => oauthApplication.clientId, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    avatar: text('avatar'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ownerNameSnapshot: text('owner_name_snapshot').notNull(),
    clientNameSnapshot: text('client_name_snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_identity_org_idx').on(table.organizationId),
    index('agent_identity_owner_idx').on(table.ownerUserId),
    index('agent_identity_client_idx').on(table.clientId),
  ],
);

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
    scopes: text('scopes').notNull(),
    mcpGrantId: text('mcp_grant_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('oauth_access_token_client_idx').on(table.clientId),
    index('oauth_access_token_user_idx').on(table.userId),
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

export const mcpGrant = pgTable(
  'mcp_grant',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    identityKind: text('identity_kind').notNull().default('legacy'),
    agentIdentityId: text('agent_identity_id').references(() => agentIdentity.id),
    ownerMemberId: text('owner_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('mcp_grant_client_user_unique').on(table.clientId, table.userId),
    uniqueIndex('mcp_grant_legacy_unique')
      .on(table.clientId, table.userId)
      .where(sql`${table.identityKind} = 'legacy'`),
    index('mcp_grant_user_idx').on(table.userId),
  ],
);
