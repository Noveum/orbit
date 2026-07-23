'use client';

import type { OnboardingTheme } from '@orbit/shared/constants';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { advanceStep } from '../api.ts';
import type { OnboardingStatusView } from '../types.ts';

const OPTIONS: readonly { value: OnboardingTheme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export interface ThemeStepProps {
  readonly onNext: (status: OnboardingStatusView) => void;
}

export function ThemeStep({ onNext }: ThemeStepProps) {
  const { theme, setTheme } = useTheme();
  const [selected, setSelected] = useState<OnboardingTheme>('system');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (theme === 'light' || theme === 'dark' || theme === 'system') setSelected(theme);
  }, [theme]);

  function choose(value: OnboardingTheme): void {
    setSelected(value);
    setTheme(value);
  }

  async function finish(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      onNext(await advanceStep({ step: 'theme', theme: selected }));
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="onboarding-theme">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">Pick your theme</h1>
        <p className="text-muted text-dense">
          Change it anytime from settings. This is your last step.
        </p>
      </header>

      <fieldset className="grid grid-cols-3 gap-3">
        <legend className="sr-only">Theme</legend>
        {OPTIONS.map((option) => {
          const active = selected === option.value;
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-lg border px-3 py-5 text-dense transition-colors',
                'focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2',
                active
                  ? 'border-accent bg-surface-2 text-text'
                  : 'border-border bg-surface text-muted hover:text-text',
              )}
            >
              <input
                type="radio"
                name="onboarding-theme"
                value={option.value}
                checked={active}
                onChange={() => choose(option.value)}
                className="sr-only"
              />
              <Icon className="size-5" aria-hidden="true" />
              {option.label}
            </label>
          );
        })}
      </fieldset>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div>
        <Button
          type="button"
          variant="primary"
          onClick={() => finish().catch(() => undefined)}
          disabled={pending}
        >
          {pending ? 'Finishing' : 'Go to workspace'}
        </Button>
      </div>
    </div>
  );
}
