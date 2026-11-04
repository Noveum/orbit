import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { ProjectUpdatesFeed } from '@/features/projects/project-feed.tsx';

describe('ProjectUpdatesFeed', () => {
  it('renders an empty state when there are no updates', () => {
    render(<ProjectUpdatesFeed updates={[]} />);
    expect(screen.getByText('No project updates posted yet')).toBeInTheDocument();
  });

  it('renders update cards with project link, health chip, and author', () => {
    const updates = [
      {
        id: 'update_1',
        projectId: 'proj_1',
        projectName: 'Realtime Sync',
        projectSlug: 'realtime-sync',
        health: 'on_track' as const,
        body: 'Completed initial socket tests.',
        createdAt: '2026-08-30T10:00:00.000Z',
        author: {
          id: 'user_1',
          name: 'Alex Rivera',
          image: null,
        },
        staleDays: undefined,
      },
      {
        id: 'update_2',
        projectId: 'proj_2',
        projectName: 'Mobile App',
        projectSlug: 'mobile-app',
        health: 'at_risk' as const,
        body: 'Waiting on auth designs.',
        createdAt: '2026-08-29T15:30:00.000Z',
        author: {
          id: 'user_2',
          name: 'Sam Chen',
          image: 'https://example.com/sam.png',
        },
        staleDays: undefined,
      },
    ];

    render(<ProjectUpdatesFeed updates={updates} />);

    expect(screen.getByText('Realtime Sync')).toBeInTheDocument();
    expect(screen.getByText('Mobile App')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('Completed initial socket tests.')).toBeInTheDocument();
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Sam Chen')).toBeInTheDocument();

    const firstTime = screen.getByText('30 Aug 2026');
    expect(firstTime).toBeInTheDocument();
    expect(firstTime).toHaveAttribute('dateTime', '2026-08-30T10:00:00.000Z');

    const secondTime = screen.getByText('29 Aug 2026');
    expect(secondTime).toBeInTheDocument();
    expect(secondTime).toHaveAttribute('dateTime', '2026-08-29T15:30:00.000Z');

    const link = screen.getByRole('link', { name: 'Realtime Sync' });
    expect(link).toHaveAttribute('href', '/projects/realtime-sync');
    expect(screen.queryByText(/days ago/)).not.toBeInTheDocument();
  });

  it('renders a muted stale marker next to the health chip when the project is stale', () => {
    render(
      <ProjectUpdatesFeed
        updates={[
          {
            id: 'update_3',
            projectId: 'proj_3',
            projectName: 'Payments',
            projectSlug: 'payments',
            health: 'at_risk' as const,
            body: 'No movement this month.',
            createdAt: '2026-08-01T10:00:00.000Z',
            author: null,
            staleDays: 21,
          },
        ]}
      />,
    );

    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('21 days ago')).toBeInTheDocument();
  });
});
