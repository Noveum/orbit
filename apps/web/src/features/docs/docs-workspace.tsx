'use client';

import { FileText, LayoutTemplate } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
import { cn } from '@/lib/cn.ts';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import {
  useCreateCollection,
  useDeleteCollection,
  useDocs,
  useRenameCollection,
} from '@/lib/query/use-docs.ts';
import { DocSurface } from './doc-surface.tsx';
import { DocTree } from './doc-tree.tsx';
import { DOC_TEMPLATES } from './templates.ts';

const SEARCH_DEBOUNCE_MS = 200;

export interface DocsWorkspaceProps {
  readonly docId: string | null;
  readonly canWrite: boolean;
  readonly canPublish: boolean;
  readonly startEditing?: boolean;
}

export function DocsWorkspace({
  docId,
  canWrite,
  canPublish,
  startEditing = false,
}: DocsWorkspaceProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [unsavedDocId, setUnsavedDocId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const list = useDocs(query);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const createCollection = useCreateCollection();
  const renameCollection = useRenameCollection();
  const deleteCollection = useDeleteCollection();

  const newDoc = useCallback(() => router.push('/docs/new'), [router]);
  useHotkey(
    'c',
    () => {
      if (canWrite) newDoc();
    },
    {
      label: 'New doc',
      section: 'Navigation',
      scope: 'docs',
      priority: HOTKEY_PRIORITY.surface,
      advertised: canWrite,
    },
  );

  const docs = list.data?.docs ?? [];
  const collections = list.data?.collections ?? [];
  const projects = list.data?.projects ?? [];

  const templates = canWrite ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" data-testid="doc-templates">
          <LayoutTemplate className="size-3.5" aria-hidden="true" />
          Templates
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Start from a template</DropdownMenuLabel>
        {DOC_TEMPLATES.map((template) => (
          <DropdownMenuItem
            key={template.id}
            data-testid={`doc-template-${template.id}`}
            onSelect={() => router.push(`/docs/new?template=${template.id}`)}
          >
            {template.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <div className="relative flex h-full min-h-0" data-testid="docs-workspace">
      {treeOpen ? (
        <button
          type="button"
          aria-label="Close doc tree"
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
          onClick={() => setTreeOpen(false)}
        />
      ) : null}

      <div
        className={cn(
          'z-40 h-full shrink-0',
          treeOpen
            ? 'fixed inset-y-0 left-0 shadow-pop lg:static lg:shadow-none'
            : 'hidden lg:block',
        )}
      >
        <DocTree
          docs={docs}
          collections={collections}
          activeDocId={docId}
          unsavedDocId={unsavedDocId}
          search={search}
          onSearchChange={setSearch}
          onCreateCollection={(name) => createCollection.mutate(name)}
          onRenameCollection={(id, name) => renameCollection.mutate({ id, name })}
          onDeleteCollection={(id) => deleteCollection.mutate(id)}
          canWrite={canWrite}
          onNavigate={() => setTreeOpen(false)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {docId === null ? (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-3">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Toggle doc tree"
                data-testid="toggle-doc-tree"
                className="size-7 px-0 lg:hidden"
                onClick={() => setTreeOpen((value) => !value)}
              >
                <FileText className="size-4" aria-hidden="true" />
              </Button>
              <span className="flex-1" />
              {templates}
              {canWrite ? (
                <Button variant="primary" size="sm" data-testid="new-doc" onClick={newDoc}>
                  New doc
                  <Kbd keys={['c']} className="ml-1 opacity-70" />
                </Button>
              ) : null}
            </div>
            <EmptyState
              icon={<FileText strokeWidth={1.75} aria-hidden="true" />}
              title={docs.length === 0 ? 'No docs yet' : 'Pick a doc'}
              description={
                docs.length === 0
                  ? 'Docs are markdown, live for everyone in the workspace, and can be published to the web.'
                  : 'Choose a doc from the tree to read it, or start a new one.'
              }
              className="flex-1"
              action={
                canWrite ? (
                  <Button variant="secondary" size="sm" onClick={newDoc}>
                    New doc
                  </Button>
                ) : undefined
              }
            />
          </>
        ) : (
          <DocSurface
            docId={docId}
            docs={docs}
            collections={collections}
            projects={projects}
            canWrite={canWrite}
            canPublish={canPublish}
            startEditing={startEditing}
            onUnsavedChange={setUnsavedDocId}
            onToggleTree={() => setTreeOpen((value) => !value)}
          />
        )}
      </div>
    </div>
  );
}
