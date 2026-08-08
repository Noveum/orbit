import { describe, expect, it } from 'bun:test';
import { defaultViewState, inCondition, virtualViewState } from '@orbit/shared/filters';
import { savedViewPath, viewHref, viewLayoutMode } from '@/features/views/view-href.ts';
import type { ViewScopeSource } from '@/features/views/view-scope.ts';
import type { Project, Team, View } from '@/lib/query/schemas.ts';

const TEAMS: readonly Team[] = [
  { id: 'team-ai', name: 'AI', key: 'AI', icon: 'circle', color: '#5b6cf9' },
  { id: 'team-eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#f95b6c' },
];

const PROJECTS: readonly Project[] = [
  {
    id: 'project-atlas',
    slug: 'atlas',
    name: 'Atlas',
    status: 'planned',
    color: '#5a63c8',
    icon: 'box',
    teamIds: [],
  },
];

const SOURCE: ViewScopeSource = { teams: TEAMS, projects: PROJECTS };

function view(overrides: Partial<View> = {}): View {
  return {
    id: 'view-1',
    ownerId: 'user-1',
    name: 'Saved',
    filter: defaultViewState('list'),
    layout: 'list',
    groupBy: 'state',
    shared: false,
    virtual: false,
    locked: false,
    favorite: false,
    readable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function builtIn(id: 'virtual:all' | 'virtual:assigned'): View {
  return view({
    id,
    name: id,
    virtual: true,
    locked: true,
    filter: virtualViewState(id, 'user-1'),
  });
}

describe('a view that covers the whole workspace', () => {
  it('opens a workspace destination rather than the first team', () => {
    const href = viewHref(builtIn('virtual:all'), SOURCE);

    expect(href).toBe(savedViewPath('virtual:all'));
    expect(href.startsWith('/team/')).toBe(false);
    for (const team of TEAMS) expect(href).not.toContain(team.key.toLowerCase());
  });

  it('does the same for a saved view nobody scoped to a team', () => {
    const workspaceWide = view({
      id: 'view-77',
      filter: { ...defaultViewState('board'), teamId: null },
      layout: 'board',
    });

    expect(viewHref(workspaceWide, SOURCE)).toBe('/views/view-77');
  });

  it('does the same for a project view, which no single team owns', () => {
    const projectView = view({
      id: 'view-88',
      filter: { ...defaultViewState('list'), teamId: null, projectId: 'project-atlas' },
    });

    expect(viewHref(projectView, SOURCE)).toBe('/views/view-88');
  });

  it('refuses to guess a team when the stored one is gone', () => {
    const orphan = view({
      id: 'view-99',
      filter: { ...defaultViewState('list'), teamId: 'team-deleted' },
    });

    expect(viewHref(orphan, SOURCE)).toBe('/views/view-99');
  });

  it('escapes the colon in a built-in id so the path stays one segment', () => {
    expect(savedViewPath('virtual:assigned')).toBe('/views/virtual%3Aassigned');
    expect(savedViewPath('virtual:assigned').split('/')).toHaveLength(3);
  });
});

describe('a view scoped to one team', () => {
  it('opens that team and carries its own filter, grouping and id', () => {
    const teamView = view({
      id: 'view-42',
      filter: {
        ...defaultViewState('list'),
        teamId: 'team-eng',
        groupBy: 'assignee',
        filter: {
          kind: 'group',
          combinator: 'and',
          children: [inCondition('priority', ['1'])],
        },
      },
    });

    const href = viewHref(teamView, SOURCE);

    expect(href.startsWith('/team/eng/issues?')).toBe(true);
    const search = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(search.get('group')).toBe('assignee');
    expect(search.get('view')).toBe('view-42');
    expect(search.get('filter')).toContain('priority');
  });

  it('opens the board when the view was saved as a board', () => {
    const boardView = view({
      id: 'view-43',
      layout: 'board',
      filter: { ...defaultViewState('board'), teamId: 'team-ai' },
    });

    expect(viewHref(boardView, SOURCE).startsWith('/team/ai/board')).toBe(true);
  });
});

describe('the standup view', () => {
  it('keeps its own page', () => {
    const standup = view({
      id: 'virtual:standup',
      virtual: true,
      filter: virtualViewState('virtual:standup', 'user-1'),
    });

    expect(viewHref(standup, SOURCE)).toBe('/standup');
  });
});

describe('viewLayoutMode', () => {
  it('treats anything that is not a board as a list', () => {
    expect(viewLayoutMode('board')).toBe('board');
    expect(viewLayoutMode('list')).toBe('list');
    expect(viewLayoutMode('timeline')).toBe('list');
  });
});
