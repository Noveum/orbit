import { describe, expect, it } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceLogo } from '@/components/layout/workspace-logo.tsx';

describe('WorkspaceLogo', () => {
  it('renders the single letter initial fallback when logo is not provided', () => {
    render(<WorkspaceLogo name="Acme Corp" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the initial fallback when logo is empty or whitespace', () => {
    render(<WorkspaceLogo name="Beta Labs" logo="   " />);
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the image element when a valid logo URL is provided', () => {
    render(<WorkspaceLogo name="Acme Corp" logo="https://example.com/logo.png" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
    expect(img).toHaveAttribute('alt', 'Acme Corp');
    expect(screen.queryByText('A')).toBeNull();
  });

  it('falls back to the initial when the image fails to load', () => {
    render(<WorkspaceLogo name="Acme Corp" logo="https://example.com/broken.png" />);
    const img = screen.getByRole('img');
    fireEvent.error(img);

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('resets failure and displays image when logo prop changes', () => {
    const { rerender } = render(
      <WorkspaceLogo name="Acme Corp" logo="https://example.com/broken.png" />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('A')).toBeInTheDocument();

    rerender(<WorkspaceLogo name="Acme Corp" logo="https://example.com/fixed.png" />);
    const newImg = screen.getByRole('img');
    expect(newImg).toHaveAttribute('src', 'https://example.com/fixed.png');
    expect(screen.queryByText('A')).toBeNull();
  });

  it('applies the appropriate size styles for sm and md', () => {
    const { rerender } = render(<WorkspaceLogo name="Acme Corp" size="sm" />);
    expect(screen.getByText('A')).toHaveClass('size-4');

    rerender(<WorkspaceLogo name="Acme Corp" size="md" />);
    expect(screen.getByText('A')).toHaveClass('size-5');
  });
});
