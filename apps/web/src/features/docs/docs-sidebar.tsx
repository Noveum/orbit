'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { cn } from '@/lib/cn.ts';
import { appDocUrl } from '@/lib/docs/paths.ts';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import {
  useArchiveDoc,
  useCreateCollection,
  useDeleteCollection,
  useDeleteDoc,
  useDocs,
  useDuplicateDoc,
  useMoveDoc,
  useRenameCollection,
  useRestoreDoc,
  useUpdateDocTitle,
} from '@/lib/query/use-docs.ts';
import { DocArchiveSection } from './doc-archive-section.tsx';
import type { DocRowActions } from './doc-row-menu.tsx';
import { DocTree } from './doc-tree.tsx';
import { useDocsTree } from './use-docs-tree.ts';

const SEARCH_DEBOUNCE_MS = 200;

export interface DocsSidebarProps {
  readonly canWrite: boolean;
}

export function DocsSidebar({ canWrite }: DocsSidebarProps) {
  const router = useRouter();
  const params = useParams<{ id?: string | string[] }>();
  const activeDocId = typeof params.id === 'string' ? params.id : null;
  const { open, close, unsavedDocId } = useDocsTree();
  const { toast } = useToast();
  const workspace = useWorkspace();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const list = useDocs(query);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const createCollection = useCreateCollection();
  const renameCollection = useRenameCollection();
  const deleteCollection = useDeleteCollection();
  const moveDoc = useMoveDoc();
  const archiveDoc = useArchiveDoc();
  const restoreDoc = useRestoreDoc();
  const deleteDoc = useDeleteDoc();
  const duplicateDoc = useDuplicateDoc();
  const renameDoc = useUpdateDocTitle();

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

  const actions = useMemo<DocRowActions>(
    () => ({
      canDelete: (doc) => workspace.role === 'admin' || doc.authorId === workspace.userId,
      onRename: () => undefined,
      onMove: (doc, collectionId) =>
        moveDoc.mutate({
          docId: doc.id,
          collectionId,
          projectId: collectionId === null ? doc.projectId : null,
          parentId: null,
          beforeId: null,
          afterId: null,
        }),
      onDuplicate: (doc) => duplicateDoc.mutate(doc.id),
      onCopyLink: (doc) => {
        navigator.clipboard
          .writeText(appDocUrl(doc.id, window.location.origin))
          .then(() => toast({ title: 'Link copied' }))
          .catch(() => toast({ title: 'Could not copy the link', tone: 'danger' }));
      },
      onArchive: (doc) => {
        archiveDoc.mutate(doc.id);
        toast({
          title: `Archived ${doc.title}`,
          action: { label: 'Undo', onSelect: () => restoreDoc.mutate(doc.id) },
        });
      },
      onDelete: (doc) => deleteDoc.mutate(doc.id),
    }),
    [
      archiveDoc,
      deleteDoc,
      duplicateDoc,
      moveDoc,
      restoreDoc,
      toast,
      workspace.role,
      workspace.userId,
    ],
  );

  const createInCollection = useCallback(
    (collectionId: string | null) =>
      router.push(collectionId === null ? '/docs/new' : `/docs/new?collection=${collectionId}`),
    [router],
  );

  const searching = useMemo(
    () => search.trim() !== query.trim() || list.isFetching,
    [search, query, list.isFetching],
  );

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close doc tree"
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
          onClick={close}
        />
      ) : null}

      <div
        className={cn(
          'z-40 h-full shrink-0',
          open ? 'fixed inset-y-0 left-0 shadow-pop lg:static lg:shadow-none' : 'hidden lg:block',
        )}
      >
        <DocTree
          docs={docs}
          collections={collections}
          activeDocId={activeDocId}
          unsavedDocId={unsavedDocId}
          search={search}
          searching={searching}
          onSearchChange={setSearch}
          onCreateCollection={(name) => createCollection.mutate(name)}
          onRenameCollection={(id, name) => renameCollection.mutate({ id, name })}
          onDeleteCollection={(id) => deleteCollection.mutate(id)}
          onCreateDoc={createInCollection}
          onMoveDoc={(move) => moveDoc.mutate(move)}
          onRenameDoc={(docId, title) => renameDoc.mutate({ docId, title })}
          {...(canWrite ? { actions } : {})}
          canWrite={canWrite}
          footer={<DocArchiveSection canWrite={canWrite} />}
          onNavigate={close}
        />
      </div>
    </>
  );
}
