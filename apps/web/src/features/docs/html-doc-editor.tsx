'use client';

import { ChevronDown, Code2, Columns2, Eye } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';
import { HtmlCodeEditor } from './editor/html-code-editor.tsx';
import { HtmlPreview } from './html-preview.tsx';

const VIEW_OPTIONS = [
  { id: 'split', label: 'Split', Icon: Columns2 },
  { id: 'source', label: 'Source', Icon: Code2 },
  { id: 'preview', label: 'Preview', Icon: Eye },
] as const;
type HtmlView = (typeof VIEW_OPTIONS)[number]['id'];

export interface HtmlDocEditorProps {
  readonly title: string;
  readonly content: string;
  readonly onChange: (value: string) => void;
  readonly footer?: React.ReactNode;
}

function HtmlDocDock({ children }: { readonly children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0 border-border border-t">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        data-testid="html-comments-toggle"
        className="h-9 w-full justify-start gap-1.5 rounded-none px-6 text-2xs text-muted"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown
          className={cn(
            'size-3.5 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none',
            open ? null : '-rotate-90',
          )}
          aria-hidden="true"
        />
        Comments
      </Button>
      {open ? (
        <div
          data-testid="html-comments-panel"
          className="max-h-[min(22rem,36vh)] overflow-y-auto px-6 pb-4"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function HtmlDocEditor({ title, content, onChange, footer }: HtmlDocEditorProps) {
  const [view, setView] = useState<HtmlView>('split');
  const showSource = view !== 'preview';
  const showPreview = view !== 'source';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="html-doc-editor">
      <div className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-3">
        {VIEW_OPTIONS.map((entry) => {
          const Icon = entry.Icon;
          return (
            <Button
              key={entry.id}
              variant="ghost"
              size="sm"
              aria-pressed={view === entry.id}
              data-testid={`html-view-${entry.id}`}
              className={cn(
                'h-7 gap-1.5 px-2 text-2xs',
                tabHover,
                view === entry.id ? 'bg-surface-2 text-text' : 'text-muted',
              )}
              onClick={() => setView(entry.id)}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {entry.label}
            </Button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showSource ? (
          <div
            className={cn(
              'min-h-0 min-w-0 flex-1 overflow-hidden',
              showPreview ? 'border-border border-r' : '',
            )}
          >
            <HtmlCodeEditor
              value={content}
              onChange={onChange}
              ariaLabel={`HTML source for ${title}`}
            />
          </div>
        ) : null}
        {showPreview ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
            <HtmlPreview title={title} html={content} />
          </div>
        ) : null}
      </div>
      {footer === undefined ? null : <HtmlDocDock>{footer}</HtmlDocDock>}
    </div>
  );
}
