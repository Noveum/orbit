import { createHmac, timingSafeEqual } from 'node:crypto';
import { forbidden, unauthorized } from '@orbit/shared/errors';
import { db, sql } from '../../src/index.ts';

const PREFIX = 'orbit-mcp-v1';
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string | null {
  if (!SEGMENT.test(value)) return null;
  const result = Buffer.from(value, 'base64url').toString('utf8');
  return result.length > 0 && encode(result) === value ? result : null;
}

export function bindLegacyMcpCredential(
  credential: string,
  grantId: string,
  secret: string,
): string {
  const payload = `${PREFIX}.${encode(grantId)}.${encode(credential)}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

function unbind(credential: string, secret: string) {
  if (credential.length > 4096 || secret.length === 0) return null;
  const parts = credential.split('.');
  const [prefix, grant, token, signature] = parts;
  if (
    parts.length !== 4 ||
    prefix !== PREFIX ||
    grant === undefined ||
    token === undefined ||
    signature === undefined
  )
    return null;
  const expected = createHmac('sha256', secret)
    .update(`${PREFIX}.${grant}.${token}`)
    .digest('base64url');
  const providedBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  )
    return null;
  const grantId = decode(grant);
  const rawToken = decode(token);
  return grantId === null || rawToken === null ? null : { grantId, credential: rawToken };
}

export async function verifyLegacyMcpAccessToken(token: string, now = new Date()) {
  const invalid = unauthorized('That access token is not valid.');
  const binding = unbind(token, process.env['BETTER_AUTH_SECRET'] ?? '');
  if (binding === null) throw invalid;
  const [record] = await db.execute<{
    user_id: string | null;
    client_id: string;
    access_token_expires_at: Date;
    scopes: string;
    grant_id: string | null;
    organization_id: string | null;
    grant_scopes: string | null;
    revoked_at: Date | null;
  }>(sql`
    select token.user_id, token.client_id, token.access_token_expires_at, token.scopes,
      g.id as grant_id, g.organization_id, g.scopes as grant_scopes, g.revoked_at
    from oauth_access_token token left join mcp_grant g
      on g.id = ${binding.grantId} and g.client_id = token.client_id and g.user_id = token.user_id
    where token.access_token = ${binding.credential} limit 1
  `);
  if (record === undefined || record.user_id === null) throw invalid;
  if (record.access_token_expires_at <= now) throw unauthorized('That access token has expired.');
  if (
    record.grant_id === null ||
    record.organization_id === null ||
    record.grant_scopes === null ||
    record.revoked_at !== null
  ) {
    throw unauthorized('This connection has been revoked. Reconnect Orbit to continue.');
  }
  const granted = new Set(record.grant_scopes.split(/\s+/).filter(Boolean));
  if (
    record.scopes
      .split(/\s+/)
      .filter(Boolean)
      .some((scope) => !granted.has(scope))
  )
    throw invalid;
  const [membership] = await db.execute<{ role: string }>(sql`
    select member.role from member inner join organization on organization.id = member.organization_id
    where member.user_id = ${record.user_id} and member.organization_id = ${record.organization_id}
      and organization.deletion_requested_at is null limit 1
  `);
  if (membership === undefined) throw forbidden('You are not a member of this workspace.');
  const teams = await db.execute<{ team_id: string }>(sql`
    select team_member.team_id from team_member inner join team on team.id = team_member.team_id
    where team_member.user_id = ${record.user_id} and team.organization_id = ${record.organization_id}
  `);
  await db.execute(
    sql`update mcp_grant set last_used_at = ${now.toISOString()}::timestamptz where id = ${record.grant_id}`,
  );
  return {
    userId: record.user_id,
    clientId: record.client_id,
    organizationId: record.organization_id,
    scopes: record.scopes,
    principal: {
      userId: record.user_id,
      organizationId: record.organization_id,
      role: membership.role,
      teamIds: teams.map((row) => row.team_id),
    },
  };
}
