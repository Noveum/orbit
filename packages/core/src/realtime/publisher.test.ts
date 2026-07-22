import { scopes, syncActionSchema } from '@orbit/shared/events';
import { describe, expect, it } from 'vitest';
import { buildSyncAction, publishDeltas } from './publisher.ts';

describe('buildSyncAction', () => {
  it('stamps an ISO timestamp, dedupes scopes, and matches the shared contract', () => {
    const action = buildSyncAction({
      syncId: 12,
      organizationId: 'org_1',
      scopes: [scopes.organization('org_1'), scopes.team('team_1'), scopes.organization('org_1')],
      action: 'update',
      model: 'issue',
      modelId: 'issue_1',
      data: { id: 'issue_1' },
      actor: { type: 'user', id: 'user_1', name: 'Ada' },
      at: new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(action.at).toBe('2026-01-02T03:04:05.000Z');
    expect(action.scopes).toEqual(['org:org_1', 'team:team_1']);
    expect(() => syncActionSchema.parse(action)).not.toThrow();
  });

  it('defaults the timestamp to now', () => {
    const action = buildSyncAction({
      syncId: 1,
      organizationId: 'org_1',
      scopes: [scopes.user('user_1')],
      action: 'insert',
      model: 'view',
      modelId: 'view_1',
      data: {},
      actor: { type: 'system', id: 'system' },
    });
    expect(Date.parse(action.at)).toBeLessThanOrEqual(Date.now());
  });
});

describe('publishDeltas', () => {
  it('is a no op when there is nothing to publish or no redis configured', async () => {
    await expect(publishDeltas([])).resolves.toBeUndefined();
    await expect(
      publishDeltas([
        buildSyncAction({
          syncId: 1,
          organizationId: 'org_1',
          scopes: [scopes.organization('org_1')],
          action: 'insert',
          model: 'issue',
          modelId: 'issue_1',
          data: {},
          actor: { type: 'system', id: 'system' },
        }),
      ]),
    ).resolves.toBeUndefined();
  });
});
