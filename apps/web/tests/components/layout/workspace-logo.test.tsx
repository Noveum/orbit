import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkspaceLogo } from '@/components/layout/workspace-logo.tsx';

const realImage = window.Image;

class MockImage extends EventTarget {
  complete = false;
  naturalWidth = 0;
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private _src = '';

  get src(): string {
    return this._src;
  }

  set src(val: string) {
    this._src = val;
    setTimeout(() => {
      this.complete = true;
      if (val.includes('broken')) {
        this.naturalWidth = 0;
        const event = new Event('error');
        this.onerror?.(event);
        this.dispatchEvent(event);
      } else {
        this.naturalWidth = 100;
        const event = new Event('load');
        this.onload?.(event);
        this.dispatchEvent(event);
      }
    }, 0);
  }
}

describe('WorkspaceLogo', () => {
  beforeEach(() => {
    window.Image = MockImage as unknown as typeof Image;
  });

  afterEach(() => {
    window.Image = realImage;
  });

  it('renders the single letter initial fallback when logo is not provided', () => {
    const { container } = render(<WorkspaceLogo name="Acme Corp" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the initial fallback when logo is empty or whitespace', () => {
    const { container } = render(<WorkspaceLogo name="Beta Labs" logo="   " />);
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the image element with empty alt when a valid logo URL loads', async () => {
    const { container } = render(
      <WorkspaceLogo name="Acme Corp" logo="https://example.com/logo.png" />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
      expect(img).toHaveAttribute('alt', '');
      expect(screen.queryByText('A')).toBeNull();
    });
  });

  it('falls back to the initial when the image fails to load', async () => {
    const { container } = render(
      <WorkspaceLogo name="Acme Corp" logo="https://example.com/broken.png" />,
    );
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('A')).toBeInTheDocument();
    });
  });

  it('switches to image when logo prop changes from broken to valid', async () => {
    const { container, rerender } = render(
      <WorkspaceLogo name="Acme Corp" logo="https://example.com/broken.png" />,
    );
    await waitFor(() => {
      expect(screen.getByText('A')).toBeInTheDocument();
    });

    rerender(<WorkspaceLogo name="Acme Corp" logo="https://example.com/fixed.png" />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute('src', 'https://example.com/fixed.png');
      expect(screen.queryByText('A')).toBeNull();
    });
  });

  it('applies the appropriate size styles for sm and md', () => {
    const { container, rerender } = render(<WorkspaceLogo name="Acme Corp" size="sm" />);
    expect(container.firstElementChild).toHaveClass('size-4');

    rerender(<WorkspaceLogo name="Acme Corp" size="md" />);
    expect(container.firstElementChild).toHaveClass('size-5');
  });
});
