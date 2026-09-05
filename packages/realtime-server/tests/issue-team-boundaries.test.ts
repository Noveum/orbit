import { describe, expect, it } from 'bun:test';
import { IssueTeamBoundaries } from '../src/issue-team-boundaries.ts';

describe('IssueTeamBoundaries', () => {
  it('expires entries and removes them during a sweep', () => {
    const boundaries = new IssueTeamBoundaries(100, 4);

    boundaries.rememberMove('org_1|issue_1', 20, 'team_b', 1_000);

    expect(boundaries.get('org_1|issue_1', 1_099)).toEqual({
      teamId: 'team_b',
      moveSyncId: 20,
    });
    boundaries.sweep(1_100);
    expect(boundaries.get('org_1|issue_1', 1_100)).toBeUndefined();
    expect(boundaries.size).toBe(0);
  });

  it('evicts the least recently used entry at its configured bound', () => {
    const boundaries = new IssueTeamBoundaries(1_000, 2);

    boundaries.rememberCurrent('org_1|issue_1', 'team_a', 1_000);
    boundaries.rememberMove('org_1|issue_2', 30, 'team_b', 1_001);
    expect(boundaries.get('org_1|issue_1', 1_002)).toEqual({
      teamId: 'team_a',
      moveSyncId: null,
    });
    boundaries.rememberMove('org_1|issue_3', 40, 'team_c', 1_003);

    expect(boundaries.get('org_1|issue_2', 1_004)).toBeUndefined();
    expect(boundaries.get('org_1|issue_1', 1_004)).toBeDefined();
    expect(boundaries.get('org_1|issue_3', 1_004)).toBeDefined();
    expect(boundaries.size).toBe(2);
  });

  it('never lets an older move replace a newer boundary', () => {
    const boundaries = new IssueTeamBoundaries(1_000, 2);

    boundaries.rememberMove('org_1|issue_1', 50, 'team_c', 1_000);
    boundaries.rememberMove('org_1|issue_1', 40, 'team_b', 1_001);

    expect(boundaries.get('org_1|issue_1', 1_002)).toEqual({
      teamId: 'team_c',
      moveSyncId: 50,
    });
  });

  it('adopts an authoritative team without lowering the known move boundary', () => {
    const boundaries = new IssueTeamBoundaries(1_000, 2);

    boundaries.rememberMove('org_1|issue_1', 50, 'team_b', 1_000);
    boundaries.rememberAuthoritative('org_1|issue_1', 40, 'team_c', 1_001);

    expect(boundaries.get('org_1|issue_1', 1_002)).toEqual({
      teamId: 'team_c',
      moveSyncId: 50,
    });
  });
});
