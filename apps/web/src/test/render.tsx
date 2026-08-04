import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderOptions, type RenderResult, render as renderRaw } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

export * from '@testing-library/react';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return renderRaw(ui, { wrapper: Providers, ...options });
}
