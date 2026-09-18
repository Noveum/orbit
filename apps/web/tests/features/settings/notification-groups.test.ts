import { describe, expect, it } from 'bun:test';
import { NOTIFICATION_TYPES } from '@orbit/shared/constants';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_TYPE_LABELS,
} from '../../../src/features/settings/notification-groups.ts';

describe('notification groups', () => {
  it('places every notification type in exactly one group', () => {
    const grouped = NOTIFICATION_GROUPS.flatMap((group) => group.types);
    expect(grouped.length).toBe(NOTIFICATION_TYPES.length);
    expect([...grouped].sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it('gives every notification type a label that is not the raw identifier', () => {
    for (const type of NOTIFICATION_TYPES) {
      const label = NOTIFICATION_TYPE_LABELS[type];
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain('_');
    }
  });

  it('names every group', () => {
    for (const group of NOTIFICATION_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.types.length).toBeGreaterThan(0);
    }
  });
});
