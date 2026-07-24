import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { InboxItem } from './data.ts';
import { applyNotificationDeltas } from './inbox-view.tsx';

const TAB = 'tab_a';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'notification_1',
    type: 'issue_assigned',
    actorName: 'Ada',
    title: 'Ada assigned you ENG-3',
    body: '',
    url: '/issue/ENG-3',
    read: false,
    snoozedUntil: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: 5,
    organizationId: 'org_1',
    scopes: ['user:user_1'],
    action: 'insert',
    model: 'notification',
    modelId: 'notification_1',
    data: {
      id: 'notification_1',
      type: 'issue_assigned',
      actorName: 'Ada',
      title: 'Ada assigned you ENG-3',
      body: '',
      url: '/issue/ENG-3',
      readAt: null,
      snoozedUntil: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    actor: { type: 'user', id: 'user_2' },
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function read(base: SyncAction): SyncAction {
  return {
    ...base,
    action: 'update',
    data: { ...base.data, readAt: '2026-01-01T00:01:00.000Z' },
  };
}

describe('applyNotificationDeltas', () => {
  it('counts an insert once and adds the row', () => {
    const patch = applyNotificationDeltas([], [action()], TAB);
    expect(patch.unreadDelta).toBe(1);
    expect(patch.rows.map((row) => row.id)).toEqual(['notification_1']);
  });

  it('does not raise the badge for a subscription toggle on the same issue', () => {
    const patch = applyNotificationDeltas(
      [],
      [action({ model: 'issue_subscription', modelId: 'issue_1:user_1', data: { id: 'issue_1' } })],
      TAB,
    );
    expect(patch.unreadDelta).toBe(0);
    expect(patch.rows).toEqual([]);
  });

  it('lowers the badge when another tab marks the notification read', () => {
    const patch = applyNotificationDeltas([item()], [read(action())], TAB);
    expect(patch.unreadDelta).toBe(-1);
    expect(patch.rows[0]?.read).toBe(true);
  });

  it('raises the badge again when another tab marks it unread', () => {
    const patch = applyNotificationDeltas(
      [item({ read: true })],
      [action({ action: 'update' })],
      TAB,
    );
    expect(patch.unreadDelta).toBe(1);
    expect(patch.rows[0]?.read).toBe(false);
  });

  it('lowers the badge and drops the row when another tab deletes an unread item', () => {
    const patch = applyNotificationDeltas([item()], [action({ action: 'delete' })], TAB);
    expect(patch.unreadDelta).toBe(-1);
    expect(patch.rows).toEqual([]);
  });

  it('leaves the badge alone when a read notification is deleted', () => {
    const patch = applyNotificationDeltas(
      [item({ read: true })],
      [action({ action: 'delete' })],
      TAB,
    );
    expect(patch.unreadDelta).toBe(0);
    expect(patch.rows).toEqual([]);
  });

  it('ignores the echo of a write this tab made', () => {
    const patch = applyNotificationDeltas([], [{ ...action(), originClientId: TAB }], TAB);
    expect(patch.unreadDelta).toBe(0);
    expect(patch.rows).toEqual([]);
  });

  it('applies an insert and its read update in one burst without double counting', () => {
    const inserted = action();
    const patch = applyNotificationDeltas([], [inserted, read(inserted)], TAB);
    expect(patch.unreadDelta).toBe(0);
    expect(patch.rows).toHaveLength(1);
    expect(patch.rows[0]?.read).toBe(true);
  });

  it('never inserts a row from an update for something it has never seen', () => {
    const patch = applyNotificationDeltas([], [action({ action: 'update' })], TAB);
    expect(patch.rows).toEqual([]);
    expect(patch.unreadDelta).toBe(0);
  });

  it('raises the mention badge when a new unread mention arrives', () => {
    const base = action();
    const patch = applyNotificationDeltas(
      [],
      [{ ...base, data: { ...base.data, type: 'mention' } }],
      TAB,
    );
    expect(patch.mentionDelta).toBe(1);
    expect(patch.unreadDelta).toBe(1);
  });

  it('lowers the mention badge when an unread mention is deleted', () => {
    const patch = applyNotificationDeltas(
      [item({ type: 'mention' })],
      [action({ action: 'delete' })],
      TAB,
    );
    expect(patch.mentionDelta).toBe(-1);
  });

  it('lowers the mention badge when another tab reads a mention', () => {
    const patch = applyNotificationDeltas([item({ type: 'mention' })], [read(action())], TAB);
    expect(patch.mentionDelta).toBe(-1);
  });
});
