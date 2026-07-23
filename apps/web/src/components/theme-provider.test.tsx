import { beforeEach, describe, expect, it } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTheme } from 'next-themes';
import { ThemeProvider } from './theme-provider.tsx';

function ThemeProbe() {
  const { setTheme } = useTheme();
  return (
    <div>
      <button type="button" onClick={() => setTheme('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        light
      </button>
    </div>
  );
}

function hasClass(name: string): boolean {
  return document.documentElement.classList.contains(name);
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
  });

  it('applies the chosen theme as a class on the document', async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    await waitFor(() => {
      expect(hasClass('dark')).toBe(true);
    });
    expect(hasClass('light')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    await waitFor(() => {
      expect(hasClass('light')).toBe(true);
    });
    expect(hasClass('dark')).toBe(false);
  });
});
