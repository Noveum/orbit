'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';
import { useCopy } from '../settings/integration-card.tsx';
import {
  IMPORT_SOURCE_GUIDES,
  IMPORT_SOURCES,
  type ImportSource,
  STARTER_KINDS,
  STARTER_LABELS,
  type StarterKind,
  starterPrompt,
} from './starter-prompts.ts';

export function StarterPromptPicker({ onError }: { onError: (message: string) => void }) {
  const [kind, setKind] = useState<StarterKind>('import');
  const [source, setSource] = useState<ImportSource>('linear');
  const { copied, copy } = useCopy(onError);
  const prompt = starterPrompt(kind, source);

  return (
    <div className="flex flex-col gap-3" data-testid="starter-prompt-picker">
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="sr-only">What do you want your AI to do first?</legend>
        {STARTER_KINDS.map((entry) => {
          const active = entry === kind;
          return (
            <label
              key={entry}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5',
                tabHover,
                'focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2',
                active ? 'border-accent bg-surface-2' : 'border-border bg-surface',
              )}
            >
              <input
                type="radio"
                name="starter-prompt-kind"
                value={entry}
                checked={active}
                onChange={() => setKind(entry)}
                className="sr-only"
              />
              <span className="font-medium text-dense text-text">
                {STARTER_LABELS[entry].title}
              </span>
              <span className="text-2xs text-muted">{STARTER_LABELS[entry].summary}</span>
            </label>
          );
        })}
      </fieldset>

      {kind === 'import' ? (
        <div className="flex items-center gap-2">
          <span className="text-2xs text-faint">I use</span>
          <div className="w-48">
            <Select value={source} onValueChange={(value) => setSource(value as ImportSource)}>
              <SelectTrigger aria-label="Tool you use today">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPORT_SOURCES.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {IMPORT_SOURCE_GUIDES[entry].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      <div className="relative">
        <pre
          data-testid="starter-prompt-text"
          className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 pr-20 font-mono text-2xs text-text leading-relaxed"
        >
          {prompt}
        </pre>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute top-2 right-2"
          aria-label="Copy starter prompt"
          onClick={() => copy(prompt)}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-2xs text-faint">
        Paste it into the AI tool you connected. It shows you a plan and waits for your OK before it
        creates anything.
      </p>
    </div>
  );
}
