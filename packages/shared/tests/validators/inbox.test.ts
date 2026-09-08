import { describe, expect, it } from 'bun:test';
import {
  inboxConversationDeltaSchema,
  inboxConversationQuerySchema,
  inboxConversationReadSchema,
  inboxConversationSnoozeSchema,
} from '../../src/validators/inbox.ts';

describe('inbox contracts', () => {
  it('defaults to server-filtered activity and validates cursor and limit bounds', () => {
    expect(inboxConversationQuerySchema.parse({})).toEqual({ tab: 'activity', limit: 50 });
    expect(inboxConversationQuerySchema.safeParse({ tab: 'unknown' }).success).toBe(false);
    expect(inboxConversationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(inboxConversationQuerySchema.safeParse({ cursor: 'x'.repeat(1025) }).success).toBe(
      false,
    );
  });
  it('requires an explicit read state and supports clearing snooze', () => {
    expect(inboxConversationReadSchema.safeParse({ conversationIds: ['id'] }).success).toBe(false);
    expect(inboxConversationReadSchema.safeParse({ conversationIds: [], read: true }).success).toBe(
      false,
    );
    expect(inboxConversationSnoozeSchema.parse({ snoozedUntil: null })).toEqual({
      snoozedUntil: null,
    });
  });
  it('strips sensitive content from realtime conversation deltas', () => {
    const delta = inboxConversationDeltaSchema.parse({
      id: 'conversation',
      syncId: 1,
      lastActivitySeq: 1,
      visible: true,
      counters: { unreadCount: 1, unreadActivityCount: 1, unreadMentionCount: 0 },
      counterVersion: 2,
      title: 'Secret document',
      body: 'Private body',
      url: '/private',
    });
    expect(delta).not.toHaveProperty('title');
    expect(delta).not.toHaveProperty('body');
    expect(delta).not.toHaveProperty('url');
  });
});
