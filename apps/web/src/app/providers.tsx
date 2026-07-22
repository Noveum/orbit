'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider.tsx';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <TooltipProvider>
          <ToastProvider>
            <HotkeyProvider>{children}</HotkeyProvider>
          </ToastProvider>
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
