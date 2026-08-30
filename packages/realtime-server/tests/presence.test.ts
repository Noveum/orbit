import { describe, expect, it } from 'bun:test';
import type { PresenceMessage } from '@orbit/shared/events';
import { PresenceStore } from '../src/presence.ts';

function message(at: number, overrides: Partial<PresenceMessage> = {}): PresenceMessage {
  return {
    organizationId: 'org_1',
    scope: 'issue:issue_1',
    kind: 'viewing',
    userId: 'user_1',
    name: 'Ada',
    image: null,
    at: new Date(at).toISOString(),
    ...overrides,
  };
}

describe('PresenceStore', () => {
  it('clears moved issue presence and admits only the destination audience', () => {
    const store = new PresenceStore(1_000);
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(store.record(message(now), { teamId: 'team_old' }, now)).toBe(true);

    store.move('issue:issue_1', 'team_new', now + 10);

    expect(
      store.snapshot('issue:issue_1', { admin: false, teamIds: ['team_new'] }, now + 20),
    ).toEqual([]);
    expect(store.record(message(now + 20), { teamId: 'team_old' }, now + 20)).toBe(false);
    expect(store.record(message(now + 20), { teamId: 'team_new' }, now + 20)).toBe(true);
  });

  it('fails closed for issue messages without exact audience metadata', () => {
    const store = new PresenceStore(1_000);
    const now = Date.parse('2026-01-01T00:00:00.000Z');

    expect(store.record(message(now + 10), null, now + 10)).toBe(false);
    expect(store.record(message(now + 10), { teamId: null }, now + 10)).toBe(false);
  });

  it('filters issue snapshots by the exact publishing team', () => {
    const store = new PresenceStore(1_000);
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(store.record(message(now), { teamId: 'team_old' }, now)).toBe(true);

    expect(
      store.snapshot('issue:issue_1', { admin: false, teamIds: ['team_old'] }, now + 10),
    ).toHaveLength(1);
    expect(
      store.snapshot('issue:issue_1', { admin: false, teamIds: ['team_new'] }, now + 10),
    ).toEqual([]);
    expect(store.snapshot('issue:issue_1', { admin: true, teamIds: [] }, now + 10)).toHaveLength(1);
  });

  it('rejects a message whose original lifetime already elapsed', () => {
    const store = new PresenceStore(1_000);
    const now = Date.parse('2026-01-01T00:00:02.000Z');

    expect(store.record(message(now - 1_001), { teamId: 'team_old' }, now)).toBe(false);
    expect(store.snapshot('issue:issue_1', { admin: true, teamIds: [] }, now)).toEqual([]);
  });
});
