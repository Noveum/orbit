'use client';

import { isHtmlDoc } from '@orbit/shared/constants';
import {
  Archive,
  Check,
  Copy,
  FileCode,
  FolderInput,
  History,
  Indent,
  LayoutTemplate,
  Lock,
  MoreHorizontal,
  PanelLeft,
  Star,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { DOC_TEMPLATES, HTML_PAGE_TEMPLATE_ID } from '@/features/docs/templates.ts';
import { cn } from '@/lib/cn.ts';
import { newDocPath } from '@/lib/docs/paths.ts';
import type { Doc, DocCollection } from '@/lib/query/schemas.ts';
import { DocExportItems } from './doc-export-menu.tsx';
import { DocImport } from './doc-import.tsx';
import { type EditorMode, type ReadingWidth, useDocPreferences } from './use-doc-preferences.ts';

export interface DocHeaderProps {
  readonly doc: Doc;
  readonly trail: readonly string[];
  readonly collections: readonly DocCollection[];
  readonly favorite: boolean;
  readonly canWrite: boolean;
  readonly canWriteDocs: boolean;
  readonly saveStatus: string | null;
  readonly saveFailed: boolean;
  readonly onToggleTree: () => void;
  readonly onToggleFavorite: () => void;
  readonly onMoveToCollection: (collectionId: string | null) => void;
  readonly onDuplicate: () => void;
  readonly onOpenNestPicker: () => void;
  readonly onOpenHistory: () => void;
  readonly onArchive: () => void;
  readonly onNewDoc: () => void;
  readonly share: React.ReactNode;
}

function Breadcrumb({
  trail,
  title,
}: {
  readonly trail: readonly string[];
  readonly title: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-dense">
      {trail.map((step) => (
        <span key={step} className="hidden shrink items-center gap-1 text-faint md:flex">
          <span className="max-w-32 truncate">{step}</span>
          <span aria-hidden="true">/</span>
        </span>
      ))}
      <span data-testid="doc-header-title" className="min-w-0 flex-1 truncate text-muted">
        {title}
      </span>
    </nav>
  );
}

function MoveSubmenu({
  doc,
  collections,
  onMoveToCollection,
}: {
  readonly doc: Doc;
  readonly collections: readonly DocCollection[];
  readonly onMoveToCollection: (collectionId: string | null) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="doc-move">
        <FolderInput className="size-3.5" aria-hidden="true" />
        Move to folder
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem data-testid="move-to-private" onSelect={() => onMoveToCollection(null)}>
          <span className="flex-1">Private</span>
          {doc.collectionId === null ? (
            <Check className="size-3.5 text-accent" aria-hidden="true" />
          ) : null}
        </DropdownMenuItem>
        {collections.map((collection) => (
          <DropdownMenuItem
            key={collection.id}
            data-testid={`move-to-${collection.id}`}
            onSelect={() => onMoveToCollection(collection.id)}
          >
            <span className="flex-1 truncate">{collection.name}</span>
            {doc.collectionId === collection.id ? (
              <Check className="size-3.5 text-accent" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const READING_WIDTHS: readonly { value: ReadingWidth; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full width' },
];

const EDITOR_MODES: readonly { value: EditorMode; label: string }[] = [
  { value: 'rich', label: 'Rendered' },
  { value: 'markdown', label: 'Markdown source' },
];

function EditorViewItems() {
  const { mode, setMode, toolbar, toggleToolbar } = useDocPreferences();
  return (
    <>
      {EDITOR_MODES.map((option) => (
        <DropdownMenuItem
          key={option.value}
          data-testid={`doc-mode-${option.value}`}
          onSelect={() => setMode(option.value)}
        >
          <Check
            className={cn('size-3.5', mode === option.value ? 'opacity-100' : 'opacity-0')}
            aria-hidden="true"
          />
          {option.label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem data-testid="doc-toolbar-toggle" onSelect={toggleToolbar}>
        <Check
          className={cn('size-3.5', toolbar ? 'opacity-100' : 'opacity-0')}
          aria-hidden="true"
        />
        Formatting bar
      </DropdownMenuItem>
    </>
  );
}

function ReadingWidthItems() {
  const { width, setWidth } = useDocPreferences();
  return (
    <>
      {READING_WIDTHS.map((option) => (
        <DropdownMenuItem
          key={option.value}
          data-testid={`doc-width-${option.value}`}
          onSelect={() => setWidth(option.value)}
        >
          <Check
            className={cn('size-3.5', width === option.value ? 'opacity-100' : 'opacity-0')}
            aria-hidden="true"
          />
          {option.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function DocHeader({
  doc,
  trail,
  collections,
  favorite,
  canWrite,
  canWriteDocs,
  saveStatus,
  saveFailed,
  onToggleTree,
  onToggleFavorite,
  onMoveToCollection,
  onDuplicate,
  onOpenNestPicker,
  onOpenHistory,
  onArchive,
  onNewDoc,
  share,
}: DocHeaderProps) {
  const router = useRouter();
  const createPath = {
    collectionId: doc.collectionId,
    projectId: doc.projectId,
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-3">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Toggle doc tree"
        data-testid="toggle-doc-tree"
        className="size-7 px-0 lg:hidden"
        onClick={onToggleTree}
      >
        <PanelLeft className="size-4" aria-hidden="true" />
      </Button>

      <Breadcrumb trail={trail} title={doc.title} />

      {canWrite && saveStatus !== null ? (
        <span
          data-testid="doc-save-status"
          className={saveFailed ? 'text-2xs text-danger' : 'text-2xs text-faint'}
        >
          {saveStatus}
        </span>
      ) : null}

      {canWrite || !canWriteDocs ? null : (
        <span
          data-testid="doc-read-only"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-2xs text-muted"
        >
          <Lock className="size-3" aria-hidden="true" />
          {doc.archivedAt === null ? 'Read only' : 'Archived'}
        </span>
      )}

      <Tooltip label={favorite ? 'Unstar' : 'Star'} side="bottom">
        <Button
          variant="ghost"
          size="sm"
          aria-label={favorite ? `Unstar ${doc.title}` : `Star ${doc.title}`}
          aria-pressed={favorite}
          data-testid="doc-favorite"
          className="size-7 px-0"
          onClick={onToggleFavorite}
        >
          <Star
            className={cn('size-4', favorite ? 'fill-current text-accent' : '')}
            aria-hidden="true"
          />
        </Button>
      </Tooltip>

      {share}

      {canWrite ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                data-testid="doc-templates"
                className="hidden sm:inline-flex"
              >
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
                  onSelect={() =>
                    router.push(newDocPath({ ...createPath, templateId: template.id }))
                  }
                >
                  {template.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="hidden sm:inline-flex">
            <DocImport collectionId={doc.collectionId} projectId={doc.projectId} />
          </span>
        </>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="More doc actions"
            data-testid="doc-overflow"
            className="size-7 px-0"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canWriteDocs ? (
            <DropdownMenuItem data-testid="doc-duplicate" onSelect={onDuplicate}>
              <Copy className="size-3.5" aria-hidden="true" />
              Duplicate
            </DropdownMenuItem>
          ) : null}

          {canWrite ? (
            <DropdownMenuItem
              data-testid="doc-new-html"
              onSelect={() =>
                router.push(newDocPath({ ...createPath, templateId: HTML_PAGE_TEMPLATE_ID }))
              }
            >
              <FileCode className="size-3.5" aria-hidden="true" />
              New HTML page
            </DropdownMenuItem>
          ) : null}

          {canWrite ? (
            <>
              <MoveSubmenu
                doc={doc}
                collections={collections}
                onMoveToCollection={onMoveToCollection}
              />
              <DropdownMenuItem data-testid="doc-nest" onSelect={onOpenNestPicker}>
                <Indent className="size-3.5" aria-hidden="true" />
                Nest under a page
              </DropdownMenuItem>
            </>
          ) : null}

          <DropdownMenuSeparator />
          {isHtmlDoc(doc.kind) ? null : (
            <>
              <EditorViewItems />
              <DropdownMenuSeparator />
              <ReadingWidthItems />
              <DropdownMenuSeparator />
            </>
          )}
          <DocExportItems title={doc.title} content={doc.content} kind={doc.kind} />
          <DropdownMenuItem data-testid="doc-history-open" onSelect={onOpenHistory}>
            <History className="size-3.5" aria-hidden="true" />
            Version history
          </DropdownMenuItem>

          {canWrite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="doc-archive"
                className="text-danger data-[highlighted]:text-danger"
                onSelect={onArchive}
              >
                <Archive className="size-3.5" aria-hidden="true" />
                Archive
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canWrite ? (
        <Button
          variant="primary"
          size="sm"
          data-testid="new-doc"
          className="hidden sm:inline-flex"
          onClick={onNewDoc}
        >
          New doc
          <Kbd keys={['c']} className="ml-1 opacity-70" />
        </Button>
      ) : null}
    </div>
  );
}
