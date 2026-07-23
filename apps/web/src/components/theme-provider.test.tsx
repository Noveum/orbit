import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from './theme-provider.tsx';

describe('ThemeProvider', () => {
  it('renders its children under the theme context', () => {
    render(
      <ThemeProvider>
        <span data-testid="child">content</span>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('content');
  });
});
