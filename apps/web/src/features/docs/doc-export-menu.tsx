'use client';

import { isHtmlDoc } from '@orbit/shared/constants';
import { Download, FileCode, FileDown, FileText } from 'lucide-react';
import { useState } from 'react';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { downloadPdf } from './doc-pdf.ts';
import { exportedMarkdown, fileNameFor } from './doc-transfer.ts';

export interface DocExportMenuProps {
  readonly title: string;
  readonly content: string;
  readonly kind?: string | null | undefined;
}

function download(name: string, body: string, type: string): void {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function DocExportItems({ title, content, kind }: DocExportMenuProps) {
  const { toast } = useToast();
  const [building, setBuilding] = useState(false);

  if (isHtmlDoc(kind)) {
    return (
      <DropdownMenuItem
        data-testid="doc-export-html"
        onSelect={() => {
          try {
            download(fileNameFor(title, 'html'), content, 'text/html;charset=utf-8');
          } catch {
            toast({ title: 'Could not export', description: 'Try again.', tone: 'danger' });
          }
        }}
      >
        <FileCode className="size-3.5" aria-hidden="true" />
        HTML file
      </DropdownMenuItem>
    );
  }

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
              download(
                fileNameFor(title, 'md'),
                exportedMarkdown(title, content, origin),
                'text/markdown;charset=utf-8',
              );
            } catch {
              toast({ title: 'Could not export', description: 'Try again.', tone: 'danger' });
            }
          }}
        >
          <FileDown className="size-3.5" aria-hidden="true" />
          Markdown file
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="doc-export-pdf"
          disabled={building}
          onSelect={(event) => {
            event.preventDefault();
            setBuilding(true);
            downloadPdf({ title, markdown: content, origin: window.location.origin })
              .catch(() =>
                toast({
                  title: 'Could not build the PDF',
                  description: 'Try again, or export the Markdown instead.',
                  tone: 'danger',
                }),
              )
              .finally(() => setBuilding(false));
          }}
        >
          <FileText className="size-3.5" aria-hidden="true" />
          {building ? 'Building PDF…' : 'PDF'}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
