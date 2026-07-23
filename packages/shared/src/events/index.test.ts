import { describe, expect, it } from 'bun:test';
import {
  clientMessageSchema,
  isFresh,
  PRESENCE_TTL_MS,
  SYNC_MODELS,
  scopes,
  serverMessageSchema,
  syncActionSchema,
  syncCatchupSchema,
} from './index.ts';

const action = {
  syncId: 7,
  organizationId: 'org_1',
  scopes: [scopes.team('team_1')],
  action: 'update',
  model: 'issue',
  modelId: 'issue_1',
  data: { title: 'Ship realtime' },
  actor: { type: 'user', id: 'user_1' },
  at: new Date().toISOString(),
};

describe('event contract', () => {
  it('builds namespaced scope keys', () => {
    expect(scopes.organization('org_1')).toBe('org:org_1');
    expect(scopes.team('team_1')).toBe('team:team_1');
    expect(scopes.issue('issue_1')).toBe('issue:issue_1');
    expect(scopes.user('user_1')).toBe('user:user_1');
  });

  it('requires at least one scope on a sync action', () => {
    expect(syncActionSchema.safeParse(action).success).toBe(true);
    expect(syncActionSchema.safeParse({ ...action, scopes: [] }).success).toBe(false);
  });

  it('rejects client messages outside the protocol', () => {
    expect(clientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'subscribe', scopes: ['org:1'] }).success).toBe(
      true,
    );
    expect(clientMessageSchema.safeParse({ type: 'shutdown' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'presence', scope: 'org:1' }).success).toBe(false);
  });

  it('rejects empty server payloads', () => {
    expect(serverMessageSchema.safeParse({ type: 'delta', actions: [action] }).success).toBe(true);
    expect(serverMessageSchema.safeParse({ type: 'delta', actions: [] }).success).toBe(false);
  });

  it('names every model once so no name can carry two row shapes', () => {
    const models: readonly string[] = SYNC_MODELS;
    expect(new Set(models).size).toBe(models.length);
    for (const model of ['team_member', 'invitation', 'doc_collection', 'issue_subscription']) {
      expect(models).toContain(model);
    }
  });

  it('carries a catch up cursor on subscribe and denied scopes on the reply', () => {
    const subscribe = clientMessageSchema.safeParse({
      type: 'subscribe',
      scopes: ['org:1'],
      since: 42,
    });
    expect(subscribe.success && subscribe.data.type === 'subscribe' && subscribe.data.since).toBe(
      42,
    );
    expect(
      clientMessageSchema.safeParse({ type: 'subscribe', scopes: ['org:1'], since: -1 }).success,
    ).toBe(false);

    const subscribed = serverMessageSchema.parse({ type: 'subscribed', scopes: ['org:1'] });
    expect(subscribed.type === 'subscribed' && subscribed.denied).toEqual([]);
  });

  it('parses a catch up page of actions', () => {
    const parsed = syncCatchupSchema.safeParse({ syncId: 7, actions: [action], truncated: false });
    expect(parsed.success).toBe(true);
    expect(syncCatchupSchema.safeParse({ syncId: 7, actions: [action] }).success).toBe(false);
  });

  it('treats presence older than the ttl as stale', () => {
    const now = Date.parse('2026-01-01T00:01:00.000Z');
    expect(isFresh('2026-01-01T00:00:59.000Z', PRESENCE_TTL_MS, now)).toBe(true);
    expect(isFresh('2026-01-01T00:00:00.000Z', PRESENCE_TTL_MS, now)).toBe(false);
    expect(isFresh('not a date', PRESENCE_TTL_MS, now)).toBe(false);
  });
});
