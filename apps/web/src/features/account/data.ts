import { db, desc, eq, schema } from '@orbit/db';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server.ts';
import { deviceLabelOf } from './credentials.ts';

export interface ConnectedAccountView {
  readonly id: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly connectedAt: string;
}

export interface PasskeyView {
  readonly id: string;
  readonly name: string;
  readonly deviceType: string;
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface SessionView {
  readonly id: string;
  readonly token: string;
  readonly device: string;
  readonly ipAddress: string | null;
  readonly lastSeenAt: string;
  readonly current: boolean;
}

export async function listConnectedAccounts(): Promise<ConnectedAccountView[]> {
  const accounts = await auth.api.listUserAccounts({ headers: await headers() });
  return accounts.map((account) => ({
    id: account.id,
    providerId: account.providerId,
    accountId: account.accountId,
    connectedAt: new Date(account.createdAt).toISOString(),
  }));
}

export async function listPasskeys(userId: string): Promise<PasskeyView[]> {
  const rows = await db
    .select()
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, userId))
    .orderBy(desc(schema.passkey.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? 'Passkey',
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function countPasskeys(userId: string): Promise<number> {
  return (await listPasskeys(userId)).length;
}

export async function listActiveSessions(currentToken: string): Promise<SessionView[]> {
  const sessions = await auth.api.listSessions({ headers: await headers() });
  return sessions
    .map((session) => ({
      id: session.id,
      token: session.token,
      device: deviceLabelOf(session.userAgent),
      ipAddress: session.ipAddress ?? null,
      lastSeenAt: new Date(session.updatedAt).toISOString(),
      current: session.token === currentToken,
    }))
    .sort((first, second) => second.lastSeenAt.localeCompare(first.lastSeenAt));
}
