'use client';

import { SWATCH_COLORS } from '@orbit/shared/constants';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { swatchLift } from '@/lib/interaction.ts';

export interface ColorSwatchesProps {
  readonly value: string;
  readonly onChange: (color: string) => void;
  readonly legend: string;
  readonly disabled?: boolean;
}

export function ColorSwatches({ value, onChange, legend, disabled = false }: ColorSwatchesProps) {
  const chosen = value.toLowerCase();
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-2xs text-faint uppercase tracking-wide">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {SWATCH_COLORS.map((color) => {
          const active = color.toLowerCase() === chosen;
          return (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={active}
              onClick={() => onChange(color)}
              style={{ backgroundColor: color }}
              className={cn(
                'flex size-6 items-center justify-center rounded-full',
                swatchLift,
                'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                active ? 'scale-110' : '',
              )}
            >
              {active ? <Check className="size-3.5 text-surface" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
