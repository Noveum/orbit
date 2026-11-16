import { describe, expect, it } from 'bun:test';
import type { IssueActor } from '@orbit/shared/validators';
import { IssueActorDisplay } from '@/features/issues/issue-actor.tsx';
import { render, screen } from '@/test/render.tsx';

const actor: IssueActor = {
  type: 'agent',
  id: 'agent_1',
  name: 'Build bot',
  avatar: null,
  deleted: true,
};

describe('IssueActorDisplay', () => {
  it('renders the server-provided avatar when the image loads', () => {
    const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const naturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'naturalWidth',
    );
    if (complete === undefined || naturalWidth === undefined)
      throw new Error('Image properties missing');
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 1,
    });
    const avatar = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    try {
      render(<IssueActorDisplay actor={{ ...actor, avatar, deleted: false }} />);
      expect(screen.getByAltText(actor.name)).toHaveAttribute('src', avatar);
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'complete', complete);
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', naturalWidth);
    }
  });

  it('announces a deleted agent and distinguishes it from an unassigned slot', () => {
    render(<IssueActorDisplay actor={actor} />);

    expect(screen.getByRole('img', { name: 'Build bot (Deleted)' })).toBeInTheDocument();
    expect(screen.getByTitle('Build bot (Agent) (Deleted)')).toHaveAttribute(
      'data-actor-type',
      'agent',
    );
    expect(screen.queryByLabelText('Unassigned')).toBeNull();
  });

  it('shows the name, agent marker and deletion state together on a named property', () => {
    render(<IssueActorDisplay actor={actor} showName />);

    expect(screen.getByText('Build bot')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps human actors free of the agent and deleted markers', () => {
    render(
      <IssueActorDisplay
        actor={{ ...actor, type: 'user', name: 'Ada', deleted: false }}
        showName
      />,
    );

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.queryByText('Agent')).toBeNull();
    expect(screen.queryByText('Deleted')).toBeNull();
  });
});
