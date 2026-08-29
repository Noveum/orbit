'use client';

import { FileCode, FileText, LayoutTemplate } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { DOC_TEMPLATES, HTML_PAGE_TEMPLATE_ID } from '@/features/docs/templates.ts';
import { newDocPath } from '@/lib/docs/paths.ts';
import { useDocs } from '@/lib/query/use-docs.ts';
import { DocImport } from './doc-import.tsx';
import { DocsHome } from './docs-home.tsx';
import { useDocsTree } from './use-docs-tree.ts';

export interface DocsEmptyPaneProps {
  readonly canWrite: boolean;
}

export function DocsEmptyPane({ canWrite }: DocsEmptyPaneProps) {
  const router = useRouter();
  const { toggle } = useDocsTree();
  const list = useDocs('');
  const docs = list.data?.docs ?? [];

  const newDoc = useCallback(() => router.push(newDocPath()), [router]);
  const newHtmlPage = useCallback(
    () => router.push(newDocPath({ templateId: HTML_PAGE_TEMPLATE_ID })),
    [router],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="docs-empty-pane">
      <div
        className="flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-border border-b px-3 py-2"
        data-testid="docs-toolbar"
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label="Toggle doc tree"
          data-testid="toggle-doc-tree"
          className="size-7 px-0 lg:hidden"
          onClick={toggle}
        >
          <FileText className="size-4" aria-hidden="true" />
        </Button>
        <span className="flex-1" />
        {canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Templates"
                data-testid="doc-templates"
              >
                <LayoutTemplate className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Templates</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Start from a template</DropdownMenuLabel>
              {DOC_TEMPLATES.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  data-testid={`doc-template-${template.id}`}
                  onSelect={() => router.push(newDocPath({ templateId: template.id }))}
                >
                  {template.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canWrite ? <DocImport collectionId={null} projectId={null} /> : null}
        {canWrite ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label="New HTML page"
            data-testid="new-html-page"
            onClick={newHtmlPage}
          >
            <FileCode className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">New HTML page</span>
          </Button>
        ) : null}
        {canWrite ? (
          <Button variant="primary" size="sm" data-testid="new-doc" onClick={newDoc}>
            New doc
            <Kbd keys={['c']} className="ml-1 hidden opacity-70 sm:inline-flex" />
          </Button>
        ) : null}
      </div>
      {docs.length === 0 ? (
        <EmptyState
          icon={<FileText strokeWidth={1.75} aria-hidden="true" />}
          title="No docs yet"
          description="Docs are markdown or a self-contained HTML page, live for everyone in the workspace, and can be published to the web."
          className="flex-1"
          action={
            canWrite ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="secondary" size="sm" onClick={newDoc}>
                  New doc
                </Button>
                <Button variant="secondary" size="sm" onClick={newHtmlPage}>
                  <FileCode className="size-3.5" aria-hidden="true" />
                  New HTML page
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DocsHome />
        </div>
      )}
    </div>
  );
}
