import { describe, expect, it } from 'vitest';
import { clientMessageSchema, scopes, serverMessageSchema, syncActionSchema } from './index.ts';

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
});
