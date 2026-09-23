'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
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
  claudePromptHref,
  IMPORT_SOURCE_GUIDES,
  IMPORT_SOURCES,
  type ImportSource,
  STARTER_KINDS,
  STARTER_LABELS,
  type StarterKind,
  starterPrompt,
  starterRunsInCodingAgent,
} from './starter-prompts.ts';

export interface StarterPromptPickerProps {
  readonly onError: (message: string) => void;
  readonly clientId?: string;
  readonly clientName?: string;
}

function pasteHint(kind: StarterKind, clientName: string | undefined): string {
  if (starterRunsInCodingAgent(kind)) {
    return 'Run this in a coding agent such as Claude Code, Cursor or Codex, opened in your repository folder. It shows you a plan and waits for your OK before it creates anything.';
  }
  const target = clientName === undefined ? 'the AI tool you connected' : clientName;
  return `Paste it into ${target}. It shows you a plan and waits for your OK before it creates anything.`;
}

export function StarterPromptPicker({ onError, clientId, clientName }: StarterPromptPickerProps) {
  const [kind, setKind] = useState<StarterKind>('import');
  const [source, setSource] = useState<ImportSource>('linear');
  const { copied, copy } = useCopy(onError);
  const prompt = starterPrompt(kind, source);
  const openInClaude = clientId === 'claude' && !starterRunsInCodingAgent(kind);

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

      <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
        <div className="flex flex-wrap items-center gap-2 border-border border-b px-3 py-2">
          {kind === 'import' ? (
            <div className="flex items-center gap-2">
              <span className="text-2xs text-muted">Moving from</span>
              <div className="w-44">
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
          ) : (
            <span className="text-2xs text-muted">Starter prompt</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {openInClaude ? (
              <Button asChild variant="secondary" size="sm">
                <a href={claudePromptHref(prompt)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Open in Claude
                </a>
              </Button>
            ) : null}
            <Button type="button" variant="primary" size="sm" onClick={() => copy(prompt)}>
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
          </div>
        </div>
        <pre
          data-testid="starter-prompt-text"
          className="max-h-64 overflow-auto whitespace-pre-wrap p-3 font-mono text-2xs text-text leading-relaxed"
        >
          {prompt}
        </pre>
      </div>
      <p className="text-2xs text-faint">{pasteHint(kind, clientName)}</p>
    </div>
  );
}
