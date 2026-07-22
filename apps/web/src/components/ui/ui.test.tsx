import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Avatar } from './avatar.tsx';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';

describe('Button', () => {
  it('renders a button with the primary variant styles', () => {
    render(<Button variant="primary">Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveClass('bg-accent');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders each variant with its own classes', () => {
    const { rerender } = render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-danger');
    rerender(<Button variant="secondary">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-surface');
    rerender(<Button variant="ghost">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-transparent');
  });

  it('applies the size variant', () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-7');
  });

  it('is reachable and activatable from the keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Focus me</Button>);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire while disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('defaults to the neutral tone', () => {
    render(<Badge>Backlog</Badge>);
    expect(screen.getByText('Backlog')).toHaveClass('bg-surface-2');
  });

  it('renders the danger tone', () => {
    render(<Badge tone="danger">Urgent</Badge>);
    expect(screen.getByText('Urgent')).toHaveClass('text-danger');
  });
});

describe('Avatar', () => {
  it('falls back to initials from the name', async () => {
    render(<Avatar name="Ada Lovelace" />);
    await waitFor(() => {
      expect(screen.getByText('AL')).toBeInTheDocument();
    });
  });

  it('uses a single initial for a mononym', async () => {
    render(<Avatar name="Prince" size="sm" />);
    await waitFor(() => {
      expect(screen.getByText('P')).toBeInTheDocument();
    });
  });
});
