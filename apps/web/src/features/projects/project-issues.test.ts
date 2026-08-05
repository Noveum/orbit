import { describe, expect, it } from 'bun:test';
import type { Issue } from '@/lib/query/schemas.ts';
import { soleTeamOf } from './project-issues.tsx';

function issue(teamId: string): Issue {
  return { id: `issue_${teamId}`, teamId } as unknown as Issue;
}

describe('which team a project board belongs to', () => {
  it('is the team every issue in the project shares', () => {
    expect(soleTeamOf([issue('team_1'), issue('team_1')])).toBe('team_1');
  });

  it('is nobody when the project spans teams, rather than whichever team sorted first', () => {
    expect(soleTeamOf([issue('team_1'), issue('team_2')])).toBeNull();
  });

  it('is nobody for an empty project', () => {
    expect(soleTeamOf([])).toBeNull();
  });
});
