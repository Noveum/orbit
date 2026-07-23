import { describe, expect, it } from 'bun:test';
import { clientMessageSchema, scopes, serverMessageSchema, syncActionSchema } from './index.ts';

const validAction = {
  syncId: 12,
  organizationId: 'org_1',
  scopes: ['org:org_1', 'team:team_eng'],
  action: 'update',
  model: 'issue',
  modelId: 'issue_1',
  data: { title: 'Ship it' },
  actor: { type: 'user', id: 'user_1', name: 'Pulkit' },
  at: '2026-07-22T12:00:00.000Z',
};

describe('syncActionSchema', () => {
  it('accepts a well formed action', () => {
    expect(syncActionSchema.parse(validAction).modelId).toBe('issue_1');
  });

  it('rejects an unknown model', () => {
    expect(syncActionSchema.safeParse({ ...validAction, model: 'nope' }).success).toBe(false);
  });

  it('rejects an unknown action kind', () => {
    expect(syncActionSchema.safeParse({ ...validAction, action: 'upsert' }).success).toBe(false);
  });

  it('requires at least one scope', () => {
    expect(syncActionSchema.safeParse({ ...validAction, scopes: [] }).success).toBe(false);
  });

  it('requires a negative free sync id', () => {
    expect(syncActionSchema.safeParse({ ...validAction, syncId: -1 }).success).toBe(false);
  });

  it('rejects a non iso timestamp', () => {
    expect(syncActionSchema.safeParse({ ...validAction, at: 'yesterday' }).success).toBe(false);
  });
});

describe('clientMessageSchema', () => {
  it('accepts subscribe and unsubscribe', () => {
    expect(clientMessageSchema.safeParse({ type: 'subscribe', scopes: ['org:1'] }).success).toBe(
      true,
    );
    expect(clientMessageSchema.safeParse({ type: 'unsubscribe', scopes: ['org:1'] }).success).toBe(
      true,
    );
  });

  it('accepts a ping and a presence message', () => {
    expect(clientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true);
    expect(
      clientMessageSchema.safeParse({ type: 'presence', scope: 'issue:1', kind: 'typing' }).success,
    ).toBe(true);
  });

  it('rejects an unknown message type', () => {
    expect(clientMessageSchema.safeParse({ type: 'shout' }).success).toBe(false);
  });

  it('caps the number of scopes per message', () => {
    const many = Array.from({ length: 65 }, (_, index) => `team:${index}`);
    expect(clientMessageSchema.safeParse({ type: 'subscribe', scopes: many }).success).toBe(false);
  });
});

describe('serverMessageSchema', () => {
  it('accepts a delta batch', () => {
    expect(serverMessageSchema.safeParse({ type: 'delta', actions: [validAction] }).success).toBe(
      true,
    );
  });

  it('rejects an empty delta batch', () => {
    expect(serverMessageSchema.safeParse({ type: 'delta', actions: [] }).success).toBe(false);
  });

  it('accepts an error frame', () => {
    expect(
      serverMessageSchema.safeParse({ type: 'error', message: 'nope', code: 'forbidden' }).success,
    ).toBe(true);
  });
});

describe('scopes', () => {
  it('namespaces every entity type distinctly', () => {
    const built = [
      scopes.organization('1'),
      scopes.team('1'),
      scopes.project('1'),
      scopes.issue('1'),
      scopes.doc('1'),
      scopes.user('1'),
    ];
    expect(new Set(built).size).toBe(built.length);
    expect(scopes.issue('abc')).toBe('issue:abc');
  });
});
