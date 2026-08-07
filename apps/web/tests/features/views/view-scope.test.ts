import { describe, expect, it } from 'bun:test';
import { defaultViewState } from '@orbit/shared/filters';
import { viewHref } from '@/features/views/view-href.ts';
import type { ViewScopeSource } from '@/features/views/view-scope.ts';
import { resolveViewScope } from '@/features/views/view-scope.ts';
import type { Project, Team, View } from '@/lib/query/schemas.ts';

const TEAMS: readonly Team[] = [
  { id: 'team-eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5b6cf9' },
];

const PROJECTS: readonly Project[] = [
  {
    id: 'project-atlas',
    name: 'Atlas',
    status: 'planned',
    color: '#5a63c8',
    icon: 'box',
    teamIds: [],
  },
];

const SOURCE: ViewScopeSource = { teams: TEAMS, projects: PROJECTS };

function view(scope: { teamId?: string | null; projectId?: string | null }): View {
  return {
    id: 'view-1',
    ownerId: 'user-1',
    name: 'Saved',
    filter: {
      ...defaultViewState('list'),
      teamId: scope.teamId ?? null,
      projectId: scope.projectId ?? null,
    },
    layout: 'list',
    groupBy: 'state',
    shared: false,
    virtual: false,
    locked: false,
    favorite: false,
    readable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const CASES: readonly View[] = [
  view({}),
  view({ teamId: 'team-eng' }),
  view({ teamId: 'team-gone' }),
  view({ projectId: 'project-atlas' }),
  view({ projectId: 'project-gone' }),
  view({ teamId: 'team-eng', projectId: 'project-atlas' }),
  view({ teamId: 'team-gone', projectId: 'project-atlas' }),
  view({ teamId: 'team-eng', projectId: 'project-gone' }),
];

describe('the destination a view links to and the scope it queries', () => {
  it('name the same team whenever the link opens a team page', () => {
    for (const entry of CASES) {
      const scope = resolveViewScope(entry, SOURCE);
      const href = viewHref(entry, SOURCE);
      if (!href.startsWith('/team/')) continue;

      expect(scope.query).toEqual({ teamId: scope.team?.id ?? '' });
      expect(href.startsWith(`/team/${scope.team?.key.toLowerCase() ?? ''}/`)).toBe(true);
    }
  });

  it('send a view whose team cannot be resolved to a page that does not ask for it', () => {
    const orphan = view({ teamId: 'team-gone' });

    expect(viewHref(orphan, SOURCE)).toBe('/views/view-1');
    expect(resolveViewScope(orphan, SOURCE).query).toEqual({});
  });

  it('never asks the server for a team or project it could not resolve', () => {
    for (const entry of CASES) {
      const scope = resolveViewScope(entry, SOURCE);
      const asked = Object.values(scope.query);

      expect(asked).not.toContain('team-gone');
      expect(asked).not.toContain('project-gone');
    }
  });
});

describe('what the scope badge says', () => {
  it('names the team when the reader can see it', () => {
    expect(resolveViewScope(view({ teamId: 'team-eng' }), SOURCE).label).toBe('Engineering');
  });

  it('names the project when the view is scoped to one', () => {
    expect(resolveViewScope(view({ projectId: 'project-atlas' }), SOURCE).label).toBe('Atlas');
  });

  it('says workspace when the view was never scoped at all', () => {
    expect(resolveViewScope(view({}), SOURCE).label).toBe('Workspace');
  });

  it('refuses to claim the workspace silently when the saved team is gone', () => {
    const scope = resolveViewScope(view({ teamId: 'team-gone' }), SOURCE);

    expect(scope.label).not.toBe('Workspace');
    expect(scope.label).toContain('saved team unavailable');
    expect(scope.unresolved).toEqual(['team']);
  });

  it('says the same about a project that is gone', () => {
    const scope = resolveViewScope(view({ projectId: 'project-gone' }), SOURCE);

    expect(scope.label).toContain('saved project unavailable');
    expect(scope.unresolved).toEqual(['project']);
  });

  it('keeps the team it did resolve while flagging the project it did not', () => {
    const scope = resolveViewScope(view({ teamId: 'team-eng', projectId: 'project-gone' }), SOURCE);

    expect(scope.query['teamId']).toBe('team-eng');
    expect(scope.query['projectId']).toBeUndefined();
    expect(scope.label).toBe('Engineering, saved project unavailable');
  });
});
