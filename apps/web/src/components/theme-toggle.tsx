'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';

  return (
    <Tooltip label={isDark ? 'Light theme' : 'Dark theme'} side="bottom">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Toggle theme"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className="size-7 px-0"
      >
        {mounted && isDark ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : (
          <Moon className="size-4" aria-hidden="true" />
        )}
      </Button>
    </Tooltip>
  );
}
