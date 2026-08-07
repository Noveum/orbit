import { describe, expect, it } from 'bun:test';
import { defaultViewState } from '@orbit/shared/filters';
import { savedViewPath, viewHref } from '@/features/views/view-href.ts';
import type { ViewScopeSource } from '@/features/views/view-scope.ts';
import { resolveViewScope } from '@/features/views/view-scope.ts';
import type { View } from '@/lib/query/schemas.ts';

const SOURCE: ViewScopeSource = {
  teams: [{ id: 'team-eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#f95b6c' }],
  projects: [
    {
      id: 'project-atlas',
      name: 'Atlas',
      status: 'planned',
      color: '#5a63c8',
      icon: 'box',
      teamIds: [],
    },
  ],
};

function view(teamId: string | null, projectId: string | null, id = 'view-1'): View {
  return {
    id,
    ownerId: 'user-1',
    name: 'Saved',
    filter: { ...defaultViewState('list'), teamId, projectId },
    layout: 'list',
    groupBy: 'state',
    shared: false,
    virtual: false,
    locked: false,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const CASES: readonly View[] = [
  view(null, null, 'workspace-wide'),
  view('team-eng', null, 'known-team'),
  view('team-gone', null, 'missing-team'),
  view(null, 'project-atlas', 'known-project'),
  view(null, 'project-gone', 'missing-project'),
  view('team-gone', 'project-atlas', 'missing-team-known-project'),
  view('team-eng', 'project-atlas', 'known-team-and-project'),
];

describe('the scope a saved view is opened with', () => {
  it('asks the server only for a team the workspace actually lists', () => {
    expect(resolveViewScope(view('team-eng', null), SOURCE).params).toEqual({ teamId: 'team-eng' });
    expect(resolveViewScope(view('team-gone', null), SOURCE).params).toEqual({});
  });

  it('asks the server only for a project the workspace actually lists', () => {
    expect(resolveViewScope(view(null, 'project-atlas'), SOURCE).params).toEqual({
      projectId: 'project-atlas',
    });
    expect(resolveViewScope(view(null, 'project-gone'), SOURCE).params).toEqual({});
  });

  it('names what it narrowed to, and says Workspace only when it narrowed to nothing', () => {
    expect(resolveViewScope(view('team-eng', null), SOURCE).label).toBe('Engineering');
    expect(resolveViewScope(view(null, 'project-atlas'), SOURCE).label).toBe('Atlas');
    expect(resolveViewScope(view('team-gone', null), SOURCE).label).toBe('Workspace');
    expect(resolveViewScope(view(null, 'project-gone'), SOURCE).label).toBe('Workspace');
    expect(resolveViewScope(view(null, null), SOURCE).label).toBe('Workspace');
  });

  it('offers project filters only while the project is the scope it can honour', () => {
    expect(resolveViewScope(view(null, 'project-atlas'), SOURCE).page).toBe('project');
    expect(resolveViewScope(view(null, 'project-gone'), SOURCE).page).toBe('saved_view');
  });

  it('lets the project win over the team, the way the query and the badge both read it', () => {
    const both = resolveViewScope(view('team-eng', 'project-atlas'), SOURCE);

    expect(both.params).toEqual({ projectId: 'project-atlas' });
    expect(both.label).toBe('Atlas');
    expect(both.teamId).toBeNull();
  });
});

describe('where a view opens and what it then asks for', () => {
  it('never routes to a team page without querying that same team', () => {
    for (const entry of CASES) {
      const scope = resolveViewScope(entry, SOURCE);
      const href = viewHref(entry, SOURCE);
      if (href === savedViewPath(entry.id)) {
        expect(scope.teamId).toBeNull();
        continue;
      }
      expect(scope.team).not.toBeNull();
      expect(href).toBe(`/team/${scope.team?.key.toLowerCase() ?? ''}/issues?view=${entry.id}`);
      expect(scope.params).toEqual({ teamId: scope.team?.id ?? '' });
    }
  });
});
