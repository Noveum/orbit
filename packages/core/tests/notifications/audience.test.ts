import { describe, expect, it } from 'bun:test';
import { dedupeAudience } from '../../src/notifications/audience.ts';

describe('dedupeAudience', () => {
  it('gives each person the highest precedence reason and never two rows for one event', () => {
    const groups = dedupeAudience(
      [
        { type: 'mention', reason: 'mentioned', userIds: ['ada', 'grace'] },
        { type: 'comment_replied', reason: 'commented', userIds: ['grace', 'linus'] },
        {
          type: 'comment_created',
          reason: 'subscribed',
          userIds: ['ada', 'grace', 'linus', 'ken'],
        },
      ],
      [],
    );

    expect(groups.map((group) => [group.type, [...group.userIds]])).toEqual([
      ['mention', ['ada', 'grace']],
      ['comment_replied', ['linus']],
      ['comment_created', ['ken']],
    ]);
  });

  it('drops the excluded actor from every group', () => {
    const groups = dedupeAudience(
      [
        { type: 'mention', reason: 'mentioned', userIds: ['ada'] },
        { type: 'comment_created', reason: 'subscribed', userIds: ['ada', 'grace'] },
      ],
      ['ada'],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.type).toBe('comment_created');
    expect(groups[0]?.userIds).toEqual(['grace']);
  });

  it('collapses a repeated id inside one group', () => {
    const groups = dedupeAudience(
      [{ type: 'mention', reason: 'mentioned', userIds: ['ada', 'ada'] }],
      [],
    );
    expect(groups[0]?.userIds).toEqual(['ada']);
  });

  it('returns nothing when every candidate is excluded', () => {
    expect(
      dedupeAudience([{ type: 'mention', reason: 'mentioned', userIds: ['ada'] }], ['ada', null]),
    ).toEqual([]);
  });
});
