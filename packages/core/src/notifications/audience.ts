import type { NotificationReason, NotificationType } from '@orbit/shared/constants';
import { unique } from '@orbit/shared/utils';

export interface AudienceGroup {
  readonly type: NotificationType;
  readonly reason: NotificationReason;
  readonly userIds: readonly string[];
}

export function dedupeAudience<T extends AudienceGroup>(
  groups: readonly T[],
  excluded: readonly (string | null)[] = [],
): T[] {
  const claimed = new Set(excluded.filter((id): id is string => id !== null));
  const result: T[] = [];
  for (const group of groups) {
    const userIds = unique(group.userIds).filter((id) => !claimed.has(id));
    if (userIds.length === 0) continue;
    for (const id of userIds) claimed.add(id);
    result.push({ ...group, userIds });
  }
  return result;
}
