import { describe, expect, it } from 'bun:test';
import {
  isPullRequestNotification,
  isStatusChangeNotification,
  NOTIFICATION_TYPES,
  PULL_REQUEST_NOTIFICATION_TYPES,
  STATUS_CHANGE_NOTIFICATION_TYPES,
} from '../../src/constants/notification.ts';

describe('isStatusChangeNotification', () => {
  it('classifies every issue field move as a status change', () => {
    for (const type of STATUS_CHANGE_NOTIFICATION_TYPES) {
      expect(isStatusChangeNotification(type)).toBe(true);
    }
  });

  it('classifies assignment as a status change rather than activity', () => {
    expect(isStatusChangeNotification('issue_assigned')).toBe(true);
    expect(isStatusChangeNotification('issue_unassigned')).toBe(true);
  });

  it('leaves conversation and document notifications as activity', () => {
    expect(isStatusChangeNotification('comment_created')).toBe(false);
    expect(isStatusChangeNotification('comment_replied')).toBe(false);
    expect(isStatusChangeNotification('mention')).toBe(false);
    expect(isStatusChangeNotification('reaction')).toBe(false);
    expect(isStatusChangeNotification('document_changed')).toBe(false);
  });

  it('leaves every pull request notification as activity', () => {
    for (const type of PULL_REQUEST_NOTIFICATION_TYPES) {
      expect(isStatusChangeNotification(type)).toBe(false);
    }
  });
});

describe('STATUS_CHANGE_NOTIFICATION_TYPES', () => {
  it('shares no type with the pull request list', () => {
    const overlap = STATUS_CHANGE_NOTIFICATION_TYPES.filter((type) =>
      isPullRequestNotification(type),
    );
    expect(overlap).toEqual([]);
  });

  it('contains only declared notification types', () => {
    const declared: readonly string[] = NOTIFICATION_TYPES;
    const undeclared = STATUS_CHANGE_NOTIFICATION_TYPES.filter((type) => !declared.includes(type));
    expect(undeclared).toEqual([]);
  });

  it('splits the notification enum into two non-empty halves', () => {
    const activity = NOTIFICATION_TYPES.filter((type) => !isStatusChangeNotification(type));
    const status = NOTIFICATION_TYPES.filter((type) => isStatusChangeNotification(type));
    expect(status.length).toBe(STATUS_CHANGE_NOTIFICATION_TYPES.length);
    expect(activity.length).toBe(NOTIFICATION_TYPES.length - status.length);
    expect(activity.length).toBeGreaterThan(0);
  });
});
