'use client';

import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import {
  useCreateCollection,
  useDeleteCollection,
  useDocs,
  useRenameCollection,
} from '@/lib/query/use-docs.ts';
import { DocSurface } from './doc-surface.tsx';
import { DocTree } from './doc-tree.tsx';

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
  const [unsavedDocId, setUnsavedDocId] = useState<string | null>(null);
  const list = useDocs(search);
  const createCollection = useCreateCollection();
  const renameCollection = useRenameCollection();
  const deleteCollection = useDeleteCollection();

  const newDoc = useCallback(() => router.push('/docs/new'), [router]);
  useHotkey('c', newDoc, { label: 'New doc', section: 'Navigation', enabled: canWrite });

  const docs = list.data?.docs ?? [];
  const collections = list.data?.collections ?? [];
  const projects = list.data?.projects ?? [];

  return (
    <div className="flex h-full min-h-0" data-testid="docs-workspace">
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
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {docId === null ? (
          <>
            <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-border border-b px-3">
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
            collections={collections}
            projects={projects}
            canWrite={canWrite}
            canPublish={canPublish}
            startEditing={startEditing}
            onUnsavedChange={setUnsavedDocId}
          />
        )}
      </div>
    </div>
  );
}
