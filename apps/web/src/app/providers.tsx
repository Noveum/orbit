'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider.tsx';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>
          <HotkeyProvider>{children}</HotkeyProvider>
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
