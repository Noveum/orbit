import { describe, expect, it } from 'bun:test';
import {
  applyConversationAccess,
  applyConversationCounterDelta,
  applyConversationDismissal,
  applyConversationRead,
  applyConversationSnooze,
  applyLiveConversationEvent,
  conversationCounterContribution,
  conversationCounterDelta,
  createConversationAggregate,
  documentConversationKey,
  githubPullRequestConversationKey,
  issueConversationKey,
  legacyNotificationConversationKey,
  projectConversationKey,
  resolveNotificationConversation,
} from '../../src/notifications/conversations.ts';

describe('resolveNotificationConversation', () => {
  it('groups every GitHub pull request event under the repository and number', () => {
    const source = {
      subjectType: 'github_pull_request',
      subjectKey: 'github-pr:991:42',
      payload: { pullRequestId: 'gpr_42' },
    };
    const variants = [
      { type: 'pr_comment', entityType: 'github_pull_request', entityId: 'gpr_42' },
      { type: 'pr_review_requested', entityType: 'issue', entityId: 'iss_linked' },
      { type: 'pr_checks_failed', entityType: 'github_check_context', entityId: 'ctx_1' },
    ];

    expect(
      variants.map((variant, index) =>
        resolveNotificationConversation({
          notificationId: `ntf_${index}`,
          ...variant,
          source,
        }),
      ),
    ).toEqual([
      {
        conversationKey: 'github-pr:991:42',
        subjectType: 'github_pull_request',
        subjectId: 'gpr_42',
        category: 'activity',
      },
      {
        conversationKey: 'github-pr:991:42',
        subjectType: 'github_pull_request',
        subjectId: 'gpr_42',
        category: 'activity',
      },
      {
        conversationKey: 'github-pr:991:42',
        subjectType: 'github_pull_request',
        subjectId: 'gpr_42',
        category: 'activity',
      },
    ]);
  });

  it('builds a GitHub pull request key from an authoritative lookup result', () => {
    expect(
      resolveNotificationConversation({
        notificationId: 'ntf_pr',
        type: 'pr_approved',
        entityType: 'issue',
        entityId: 'iss_linked',
        githubPullRequest: {
          id: 'gpr_7',
          repositoryId: '9007199254740993',
          number: 7,
        },
      }),
    ).toEqual({
      conversationKey: 'github-pr:9007199254740993:7',
      subjectType: 'github_pull_request',
      subjectId: 'gpr_7',
      category: 'activity',
    });
  });

  it('keeps issue activity and field changes in separate conversations', () => {
    expect(
      resolveNotificationConversation({
        notificationId: 'ntf_comment',
        type: 'comment_created',
        entityType: 'issue',
        entityId: 'iss_1',
      }),
    ).toEqual({
      conversationKey: 'orbit-issue:iss_1:activity',
      subjectType: 'issue',
      subjectId: 'iss_1',
      category: 'activity',
    });
    expect(
      resolveNotificationConversation({
        notificationId: 'ntf_status',
        type: 'issue_status_changed',
        entityType: 'issue',
        entityId: 'iss_1',
      }),
    ).toEqual({
      conversationKey: 'orbit-issue:iss_1:status',
      subjectType: 'issue',
      subjectId: 'iss_1',
      category: 'status',
    });
  });

  it('resolves task aliases and issue comment context to the issue family', () => {
    expect(
      resolveNotificationConversation({
        notificationId: 'ntf_task',
        type: 'issue_priority_changed',
        entityType: 'task',
        entityId: 'iss_task',
      }),
    ).toMatchObject({
      conversationKey: 'orbit-issue:iss_task:status',
      subjectType: 'issue',
      subjectId: 'iss_task',
    });
    expect(
      resolveNotificationConversation({
        notificationId: 'ntf_reply',
        type: 'comment_replied',
        entityType: 'comment',
        entityId: 'cmt_1',
        issueId: 'iss_task',
      }),
    ).toMatchObject({
      conversationKey: 'orbit-issue:iss_task:activity',
      subjectType: 'issue',
      subjectId: 'iss_task',
    });
  });

  it('groups document comments, replies, mentions and changes by document', () => {
    const variants = [
      {
        notificationId: 'ntf_doc',
        type: 'document_changed',
        entityType: 'doc',
        entityId: 'doc_1',
      },
      {
        notificationId: 'ntf_mention',
        type: 'mention',
        entityType: 'doc',
        entityId: 'doc_1',
      },
      {
        notificationId: 'ntf_comment',
        type: 'comment_created',
        entityType: 'doc_comment',
        entityId: 'dc_1',
        url: '/docs/doc_1#doc-comment-dc_1',
      },
      {
        notificationId: 'ntf_reply',
        type: 'comment_replied',
        entityType: 'doc_comment',
        entityId: 'dc_2',
        documentId: 'doc_1',
      },
    ];

    expect(variants.map(resolveNotificationConversation)).toEqual(
      variants.map(() => ({
        conversationKey: 'orbit-doc:doc_1:activity',
        subjectType: 'doc',
        subjectId: 'doc_1',
        category: 'activity',
      })),
    );
  });

  it('uses project subjects and stable invitation or membership domain keys', () => {
    expect(
      resolveNotificationConversation({
        notificationId: 'ntf_project',
        type: 'project_update',
        entityType: 'project',
        entityId: 'prj_1',
      }),
    ).toEqual({
      conversationKey: 'orbit-project:prj_1:activity',
      subjectType: 'project',
      subjectId: 'prj_1',
      category: 'activity',
    });
    expect(
      resolveNotificationConversation({
        notificationId: 'ntf_invite',
        type: 'invite_accepted',
        entityType: 'invitation',
        entityId: 'inv_1',
        domainConversationKey: 'orbit-invitation:inv_1:activity',
      }),
    ).toMatchObject({
      conversationKey: 'orbit-invitation:inv_1:activity',
      subjectType: 'invitation',
      subjectId: 'inv_1',
    });
  });

  it('falls back to an isolated legacy key instead of guessing a subject', () => {
    const unresolvedPr = resolveNotificationConversation({
      notificationId: 'ntf_unresolved_pr',
      type: 'pr_comment',
      entityType: 'issue',
      entityId: 'iss_1',
    });
    const unresolvedComment = resolveNotificationConversation({
      notificationId: 'ntf_unresolved_comment',
      type: 'comment_created',
      entityType: 'comment',
      entityId: 'cmt_1',
    });

    expect(unresolvedPr).toEqual({
      conversationKey: 'legacy-notification:ntf_unresolved_pr',
      subjectType: 'legacy_notification',
      subjectId: 'ntf_unresolved_pr',
      category: 'activity',
    });
    expect(unresolvedComment.conversationKey).toBe('legacy-notification:ntf_unresolved_comment');
  });

  it('exposes deterministic key builders', () => {
    expect(githubPullRequestConversationKey('991', 42)).toBe('github-pr:991:42');
    expect(issueConversationKey('iss_1', 'activity')).toBe('orbit-issue:iss_1:activity');
    expect(documentConversationKey('doc_1')).toBe('orbit-doc:doc_1:activity');
    expect(projectConversationKey('prj_1')).toBe('orbit-project:prj_1:activity');
    expect(legacyNotificationConversationKey('ntf_1')).toBe('legacy-notification:ntf_1');
    expect(() => githubPullRequestConversationKey('bad:repo', 1)).toThrow();
  });
});

describe('conversation aggregate transitions', () => {
  const identity = {
    conversationKey: 'orbit-issue:iss_1:activity',
    subjectType: 'issue',
    subjectId: 'iss_1',
    category: 'activity' as const,
  };
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('applies a surfaced live event and clears obsolete visibility state', () => {
    const snoozed = applyConversationSnooze(
      applyConversationDismissal(createConversationAggregate(identity), now),
      new Date('2026-09-02T12:00:00.000Z'),
    );
    const next = applyLiveConversationEvent(snoozed, {
      id: 'ntf_1',
      type: 'mention',
      actorName: 'Ada',
      title: 'Mentioned you in ORB-1',
      body: 'Please review',
      url: '/issue/ORB-1',
      externalUrl: null,
      occurredAt: now,
      ingestedAt: now,
      ingestionSeq: 10,
      surfaceInInbox: true,
    });

    expect(next).toMatchObject({
      latestEventId: 'ntf_1',
      latestType: 'mention',
      latestActorName: 'Ada',
      eventCount: 1,
      unreadEventCount: 1,
      unreadMentionCount: 1,
      manualUnread: false,
      dismissedAt: null,
      snoozedUntil: null,
      lastActivitySeq: 10,
      snoozeGeneration: 3,
    });
    expect(next.lastMentionAt).toEqual(now);
  });

  it('does not aggregate a recipient event that is not surfaced in the inbox', () => {
    const initial = createConversationAggregate(identity);
    const next = applyLiveConversationEvent(initial, {
      id: 'ntf_email',
      type: 'comment_created',
      actorName: 'Ada',
      title: 'Email only',
      body: '',
      url: '/issue/ORB-1',
      externalUrl: null,
      occurredAt: now,
      ingestedAt: now,
      ingestionSeq: 11,
      surfaceInInbox: false,
    });

    expect(next).toBe(initial);
  });

  it('keeps a later sequence authoritative when an older event arrives', () => {
    const latest = applyLiveConversationEvent(createConversationAggregate(identity), {
      id: 'ntf_new',
      type: 'comment_created',
      actorName: 'Grace',
      title: 'Newest',
      body: '',
      url: '/issue/ORB-1',
      externalUrl: null,
      occurredAt: now,
      ingestedAt: now,
      ingestionSeq: 20,
      surfaceInInbox: true,
    });
    const older = applyLiveConversationEvent(latest, {
      id: 'ntf_old',
      type: 'mention',
      actorName: 'Ada',
      title: 'Older',
      body: '',
      url: '/issue/ORB-1',
      externalUrl: null,
      occurredAt: new Date('2026-08-31T12:00:00.000Z'),
      ingestedAt: new Date('2026-08-31T12:00:00.000Z'),
      ingestionSeq: 19,
      surfaceInInbox: true,
    });

    expect(older.latestEventId).toBe('ntf_new');
    expect(older.eventCount).toBe(2);
    expect(older.unreadEventCount).toBe(1);
    expect(older.unreadMentionCount).toBe(0);
  });

  it('models read, manual unread, snooze, dismissal and access hiding', () => {
    const unread = applyLiveConversationEvent(createConversationAggregate(identity), {
      id: 'ntf_1',
      type: 'comment_created',
      actorName: 'Ada',
      title: 'New comment',
      body: '',
      url: '/issue/ORB-1',
      externalUrl: null,
      occurredAt: now,
      ingestedAt: now,
      ingestionSeq: 1,
      surfaceInInbox: true,
    });
    const read = applyConversationRead(unread, true, now);
    const manualUnread = applyConversationRead(read, false, now);
    const hidden = applyConversationAccess(manualUnread, now);
    const restored = applyConversationAccess(hidden, null);

    expect(read).toMatchObject({
      unreadEventCount: 0,
      unreadMentionCount: 0,
      manualUnread: false,
      readAt: now,
    });
    expect(manualUnread).toMatchObject({
      unreadEventCount: 0,
      unreadMentionCount: 0,
      manualUnread: true,
      readAt: now,
    });
    expect(hidden.accessGeneration).toBe(1);
    expect(restored.accessGeneration).toBe(2);
  });

  it('does not add a manual unread override while real unread events remain', () => {
    const unread = applyLiveConversationEvent(createConversationAggregate(identity), {
      id: 'ntf_1',
      type: 'comment_created',
      actorName: 'Ada',
      title: 'New comment',
      body: '',
      url: '/issue/ORB-1',
      externalUrl: null,
      occurredAt: now,
      ingestedAt: now,
      ingestionSeq: 1,
      surfaceInInbox: true,
    });

    expect(applyConversationRead(unread, false, now)).toMatchObject({
      unreadEventCount: 1,
      manualUnread: false,
    });
  });

  it('computes visible conversation counters and exact deltas', () => {
    const initial = createConversationAggregate(identity);
    const unread = applyLiveConversationEvent(initial, {
      id: 'ntf_1',
      type: 'mention',
      actorName: 'Ada',
      title: 'Mention',
      body: '',
      url: '/issue/ORB-1',
      externalUrl: null,
      occurredAt: now,
      ingestedAt: now,
      ingestionSeq: 1,
      surfaceInInbox: true,
    });
    const snoozed = applyConversationSnooze(unread, new Date('2026-09-02T12:00:00.000Z'));

    expect(conversationCounterContribution(initial, now)).toEqual({
      unreadCount: 0,
      unreadActivityCount: 0,
      unreadMentionCount: 0,
    });
    expect(conversationCounterContribution(unread, now)).toEqual({
      unreadCount: 1,
      unreadActivityCount: 1,
      unreadMentionCount: 1,
    });
    expect(conversationCounterContribution(snoozed, now)).toEqual({
      unreadCount: 0,
      unreadActivityCount: 0,
      unreadMentionCount: 0,
    });
    expect(conversationCounterDelta(initial, unread, now)).toEqual({
      unreadCount: 1,
      unreadActivityCount: 1,
      unreadMentionCount: 1,
    });
    expect(conversationCounterDelta(unread, snoozed, now)).toEqual({
      unreadCount: -1,
      unreadActivityCount: -1,
      unreadMentionCount: -1,
    });
    expect(
      applyConversationCounterDelta(
        { unreadCount: 3, unreadActivityCount: 2, unreadMentionCount: 1 },
        conversationCounterDelta(unread, snoozed, now),
      ),
    ).toEqual({ unreadCount: 2, unreadActivityCount: 1, unreadMentionCount: 0 });
  });

  it('counts a manual unread status conversation without inventing an event or mention', () => {
    const status = applyConversationRead(
      createConversationAggregate({
        conversationKey: 'orbit-issue:iss_1:status',
        subjectType: 'issue',
        subjectId: 'iss_1',
        category: 'status',
      }),
      false,
      now,
    );

    expect(conversationCounterContribution(status, now)).toEqual({
      unreadCount: 1,
      unreadActivityCount: 0,
      unreadMentionCount: 0,
    });
  });
});
