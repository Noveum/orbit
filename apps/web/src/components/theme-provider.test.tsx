import { beforeEach, describe, expect, it } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTheme } from 'next-themes';
import { ThemeProvider } from './theme-provider.tsx';

function ThemeProbe() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="resolved">{resolvedTheme ?? 'unset'}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        light
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
  });

  it('renders the light theme and applies the light class', async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    await waitFor(() => {
      expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    });
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('switches to the dark theme and applies the dark class', async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    await waitFor(() => {
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });
});
