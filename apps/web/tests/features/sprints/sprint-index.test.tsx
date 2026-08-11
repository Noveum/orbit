import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import type { SprintIndexPage } from '../../../src/features/sprints/data.ts';
import { SprintIndex } from '../../../src/features/sprints/sprint-index.tsx';

function pageWith(overrides: Partial<SprintIndexPage> = {}): SprintIndexPage {
  return {
    total: 3,
    page: 1,
    pageCount: 1,
    sprints: [
      {
        id: 'cycle_3',
        name: 'Sprint 3',
        number: 3,
        startsAt: '2026-08-11T00:00:00.000Z',
        endsAt: '2026-08-25T00:00:00.000Z',
        state: 'running',
        issues: 12,
      },
      {
        id: 'cycle_2',
        name: 'Sprint 2',
        number: 2,
        startsAt: '2026-07-28T00:00:00.000Z',
        endsAt: '2026-08-11T00:00:00.000Z',
        state: 'finished',
        issues: 1,
      },
    ],
    ...overrides,
  };
}

afterEach(cleanup);

describe('the sprint index', () => {
  it('opens any sprint by its number', () => {
    render(<SprintIndex page={pageWith()} />);

    const row = screen.getByTestId('sprint-index-3');
    expect(row.getAttribute('href')).toBe('/sprints?sprint=3');
  });

  it('says which sprint is running and how much each one holds', () => {
    render(<SprintIndex page={pageWith()} />);

    expect(screen.getByTestId('sprint-index-3').textContent).toContain('Running');
    expect(screen.getByTestId('sprint-index-3').textContent).toContain('12 tasks');
    expect(screen.getByTestId('sprint-index-2').textContent).toContain('Finished');
    expect(screen.getByTestId('sprint-index-2').textContent).toContain('1 task');
  });

  it('hides the pager when everything fits on one page', () => {
    render(<SprintIndex page={pageWith()} />);

    expect(screen.queryByTestId('sprint-index-next')).toBeNull();
  });

  it('pages through a workspace with hundreds of sprints', () => {
    render(<SprintIndex page={pageWith({ total: 240, page: 4, pageCount: 10 })} />);

    expect(screen.getByTestId('sprint-index-next').getAttribute('href')).toBe(
      '/sprints/all?page=5',
    );
    expect(screen.getByTestId('sprint-index-previous').getAttribute('href')).toBe(
      '/sprints/all?page=3',
    );
    expect(screen.getByText(/Page 4 of 10, 240 sprints/)).toBeDefined();
  });

  it('leaves the edges of the range unclickable rather than pointing off the end', () => {
    render(<SprintIndex page={pageWith({ total: 60, page: 1, pageCount: 3 })} />);
    expect(screen.getByTestId('sprint-index-previous').tagName).toBe('SPAN');

    cleanup();
    render(<SprintIndex page={pageWith({ total: 60, page: 3, pageCount: 3 })} />);
    expect(screen.getByTestId('sprint-index-next').tagName).toBe('SPAN');
  });

  it('says so plainly when there are no sprints at all', () => {
    render(<SprintIndex page={pageWith({ sprints: [], total: 0 })} />);

    expect(screen.queryByTestId('sprint-index')).toBeNull();
    expect(screen.getByText('No sprints yet.')).toBeDefined();
  });
});
