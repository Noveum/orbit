import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { parseSprintTab, SprintTabs } from '@/features/sprints/sprint-tabs.tsx';

afterEach(cleanup);

describe('parseSprintTab', () => {
  it('defaults to the board', () => {
    expect(parseSprintTab(undefined)).toBe('board');
  });

  it('rejects an unknown tab', () => {
    expect(parseSprintTab('nonsense')).toBe('board');
  });

  it('keeps a known tab', () => {
    expect(parseSprintTab('insights')).toBe('insights');
  });
});

describe('SprintTabs', () => {
  it('renders only the tabs that exist yet', () => {
    render(
      <SprintTabs base="/team/nov/sprint/1" active="board" available={['board', 'insights']} />,
    );

    expect(screen.getByTestId('sprint-tab-board')).toBeDefined();
    expect(screen.getByTestId('sprint-tab-insights')).toBeDefined();
    expect(screen.queryByTestId('sprint-tab-planning')).toBeNull();
    expect(screen.queryByTestId('sprint-tab-retro')).toBeNull();
  });

  it('marks the active tab for assistive technology', () => {
    render(
      <SprintTabs base="/team/nov/sprint/1" active="insights" available={['board', 'insights']} />,
    );

    expect(screen.getByTestId('sprint-tab-insights').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('sprint-tab-board').getAttribute('aria-current')).toBeNull();
  });

  it('keeps the board on the bare url and puts every other tab in the query', () => {
    render(
      <SprintTabs base="/team/nov/sprint/1" active="board" available={['board', 'insights']} />,
    );

    expect(screen.getByTestId('sprint-tab-board').getAttribute('href')).toBe('/team/nov/sprint/1');
    expect(screen.getByTestId('sprint-tab-insights').getAttribute('href')).toBe(
      '/team/nov/sprint/1?tab=insights',
    );
  });
});
