import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { InboxItem } from '../../../src/features/inbox/data.ts';
import {
  notificationDeltaInvalidatesInbox,
  snoozeRollback,
} from '../../../src/features/inbox/inbox-view.tsx';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'notification_1',
    type: 'issue_assigned',
    entityType: 'issue',
    entityId: 'issue_1',
    actorName: 'Ada',
    title: 'Ada assigned you ENG-3',
    body: '',
    bodyHtml: '',
    url: '/issue/ENG-3',
    externalUrl: null,
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

describe('legacy notification invalidation', () => {
  it('treats every notification update as an authorized refetch, never a content patch', () => {
    for (const kind of ['insert', 'update', 'delete'] as const)
      expect(notificationDeltaInvalidatesInbox([action({ action: kind })])).toBe(true);
  });
  it('invalidates on an access-change conversation delta, including after all rows were dismissed', () => {
    expect(
      notificationDeltaInvalidatesInbox([
        action({
          model: 'notification_conversation',
          data: { id: 'conversation', visible: false },
        }),
      ]),
    ).toBe(true);
  });
  it('ignores unrelated workspace events', () => {
    expect(notificationDeltaInvalidatesInbox([action({ model: 'issue_subscription' })])).toBe(
      false,
    );
  });
  it('never trusts a cached body or own-client echo instead of rechecking access', () => {
    expect(
      notificationDeltaInvalidatesInbox([
        action({
          originClientId: 'this-client',
          data: { body: 'REVOKED_PRIVATE_BODY', title: 'Private title' },
        }),
      ]),
    ).toBe(true);
  });
});

describe('rolling back a snooze the server rejected', () => {
  it('puts back the value the row had before the failed request', () => {
    const rows = [item({ snoozedUntil: '2026-03-01T00:00:00.000Z' })];

    const rollback = snoozeRollback(rows, 'notification_1', '2026-03-01T00:00:00.000Z', null);

    expect(rollback.rows[0]?.snoozedUntil).toBeNull();
    expect(rollback.restoreCounts).toBe(true);
  });

  it('leaves a newer snooze alone rather than overwriting it', () => {
    const rows = [item({ snoozedUntil: '2026-06-01T00:00:00.000Z' })];

    const rollback = snoozeRollback(rows, 'notification_1', '2026-03-01T00:00:00.000Z', null);

    expect(rollback.rows[0]?.snoozedUntil).toBe('2026-06-01T00:00:00.000Z');
  });

  it('leaves the counts alone when it did not undo the snooze', () => {
    const rows = [item({ snoozedUntil: '2026-06-01T00:00:00.000Z' })];

    const rollback = snoozeRollback(rows, 'notification_1', '2026-03-01T00:00:00.000Z', null);

    expect(rollback.restoreCounts).toBe(false);
  });

  it('leaves every other row untouched', () => {
    const rows = [
      item({ id: 'notification_1', snoozedUntil: '2026-03-01T00:00:00.000Z' }),
      item({ id: 'notification_2', snoozedUntil: '2026-03-01T00:00:00.000Z' }),
    ];

    const rollback = snoozeRollback(rows, 'notification_1', '2026-03-01T00:00:00.000Z', null);

    expect(rollback.rows[1]?.snoozedUntil).toBe('2026-03-01T00:00:00.000Z');
  });
});
