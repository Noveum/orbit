'use client';

import { Download, FileDown, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { exportedMarkdown, fileNameFor } from './doc-transfer.ts';

export interface DocExportMenuProps {
  readonly title: string;
  readonly content: string;
}

function download(name: string, body: string): void {
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function DocExportMenu({ title, content }: DocExportMenuProps) {
  const { toast } = useToast();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Export doc" className="size-7 px-0">
          <Download className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Export</DropdownMenuLabel>
        <DropdownMenuItem
          data-testid="doc-export-markdown"
          onSelect={() => {
            try {
              const origin = window.location.origin;
              download(fileNameFor(title, 'md'), exportedMarkdown(title, content, origin));
            } catch {
              toast({ title: 'Could not export', description: 'Try again.', tone: 'danger' });
            }
          }}
        >
          <FileDown className="size-3.5" aria-hidden="true" />
          Markdown file
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="doc-export-pdf" onSelect={() => window.print()}>
          <Printer className="size-3.5" aria-hidden="true" />
          PDF, through print
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
