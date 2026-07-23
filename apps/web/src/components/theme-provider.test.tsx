import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { isValidElement, type ReactElement } from 'react';
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

  it('drives theming through the class attribute with a light and dark scheme', () => {
    const element = ThemeProvider({ children: null }) as ReactElement<Record<string, unknown>>;
    expect(isValidElement(element)).toBe(true);
    expect(element.props).toMatchObject({
      attribute: 'class',
      defaultTheme: 'system',
      enableSystem: true,
      disableTransitionOnChange: true,
      themes: ['light', 'dark'],
    });
  });
});
