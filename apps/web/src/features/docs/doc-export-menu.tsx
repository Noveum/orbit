'use client';

import { Download, FileDown, Printer } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

export function DocExportItems({ title, content }: DocExportMenuProps) {
  const { toast } = useToast();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="doc-export">
        <Download className="size-3.5" aria-hidden="true" />
        Export
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
