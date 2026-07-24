'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import {
  useCreateCollection,
  useDeleteCollection,
  useDocs,
  useRenameCollection,
} from '@/lib/query/use-docs.ts';
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
          onSearchChange={setSearch}
          onCreateCollection={(name) => createCollection.mutate(name)}
          onRenameCollection={(id, name) => renameCollection.mutate({ id, name })}
          onDeleteCollection={(id) => deleteCollection.mutate(id)}
          canWrite={canWrite}
          onNavigate={close}
        />
      </div>
    </>
  );
}
