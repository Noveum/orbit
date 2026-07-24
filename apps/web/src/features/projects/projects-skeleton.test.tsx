import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { ProjectDetailSkeleton, ProjectsSkeleton } from './projects-skeleton.tsx';

describe('projects skeletons', () => {
  it('renders the projects list skeleton', () => {
    render(<ProjectsSkeleton />);
    expect(screen.getByTestId('projects-skeleton')).toBeInTheDocument();
  });

  it('renders the project detail skeleton', () => {
    render(<ProjectDetailSkeleton />);
    expect(screen.getByTestId('project-detail-skeleton')).toBeInTheDocument();
  });
});
