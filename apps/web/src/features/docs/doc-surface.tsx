'use client';

import { useScopeSubscription } from '@orbit/realtime-client/react';
import { isHtmlDoc } from '@orbit/shared/constants';
import { scopes } from '@orbit/shared/events';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import { DOC_CONTENT_LIMIT } from '@orbit/shared/validators';
import { Check, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { cn } from '@/lib/cn.ts';
import { newDocPath } from '@/lib/docs/paths.ts';
import type { Doc, DocDetail, DocSummary, Member } from '@/lib/query/schemas.ts';
import { useDocComments } from '@/lib/query/use-doc-comments.ts';
import type { DocPatch } from '@/lib/query/use-docs.ts';
import {
  useArchiveDoc,
  useDoc,
  useDocs,
  useDuplicateDoc,
  useRecordDocVisit,
  useToggleDocFavorite,
  useUpdateDoc,
} from '@/lib/query/use-docs.ts';
import { DocAttachments } from './doc-attachments.tsx';
import { DocComments } from './doc-comments.tsx';
import { DocEditor } from './doc-editor.tsx';
import { DocGateway } from './doc-gateway.tsx';
import { DocHeader } from './doc-header.tsx';
import { DocHistory } from './doc-history.tsx';
import { DocBacklinks, DocReader } from './doc-reader.tsx';
import { DocShareMenu } from './doc-share-menu.tsx';
import { breadcrumbOf } from './doc-tree-model.ts';
import { HtmlDocEditor } from './html-doc-editor.tsx';
import { HtmlDocReader } from './html-doc-reader.tsx';
import type { SaveStatus } from './use-autosave.ts';
import { useAutosave } from './use-autosave.ts';
import type { DocAnchorTarget, DocCommenting } from './use-doc-anchors.ts';
import { useDocsTree } from './use-docs-tree.ts';
import { useEditorOutline } from './use-editor-outline.ts';

const STATUS_LABEL = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
  blocked: 'Too long to save',
} as const;

const NEAR_LIMIT = Math.round(DOC_CONTENT_LIMIT * 0.9);

const NEST_PICKER_LIMIT = 50;

export function matchParents(
  parents: readonly DocSummary[],
  search: string,
  limit: number,
): { readonly shown: DocSummary[]; readonly hiddenCount: number } {
  const query = search.trim().toLowerCase();
  const matches =
    query.length === 0
      ? parents
      : parents.filter((entry) => (entry.title ?? '').toLowerCase().includes(query));
  return { shown: matches.slice(0, limit), hiddenCount: Math.max(matches.length - limit, 0) };
}

export interface DocDraft {
  readonly title: string;
  readonly content: string;
}

export function adoptsRemoteEdit(settled: boolean, seen: DocDraft, incoming: DocDraft): boolean {
  if (seen.title === incoming.title && seen.content === incoming.content) return false;
  return settled;
}

export function anchorTargetsOf(
  comments: readonly {
    readonly comment: { readonly id: string; readonly anchor: DocCommentAnchor | null };
  }[],
): DocAnchorTarget[] {
  return comments.flatMap((entry) =>
    entry.comment.anchor === null
      ? []
      : [{ commentId: entry.comment.id, anchor: entry.comment.anchor }],
  );
}

export function descendantIds(docs: readonly DocSummary[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const doc of docs) {
    if (doc.parentId === null) continue;
    const list = children.get(doc.parentId) ?? [];
    list.push(doc.id);
    children.set(doc.parentId, list);
  }

  const blocked = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) continue;
    for (const child of children.get(next) ?? []) {
      if (blocked.has(child)) continue;
      blocked.add(child);
      queue.push(child);
    }
  }
  return blocked;
}

export interface DocSurfaceProps {
  readonly docId: string;
  readonly canWriteDocs: boolean;
  readonly canPublish: boolean;
}

function useDocList() {
  const list = useDocs('');
  return {
    docs: list.data?.docs ?? [],
    collections: list.data?.collections ?? [],
    projects: list.data?.projects ?? [],
  };
}

export function DocSurface(props: DocSurfaceProps) {
  const detail = useDoc(props.docId);
  const docScopes = useMemo(() => [scopes.doc(props.docId)], [props.docId]);
  useScopeSubscription(docScopes);

  if (detail.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-[45rem] flex-col gap-4 px-6 py-10">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (detail.data === undefined) return <DocGateway docId={props.docId} />;

  return <LoadedDoc key={detail.data.doc.id} detail={detail.data} {...props} />;
}

function docWriteAccess(canWriteDocs: boolean, detail: DocDetail): boolean {
  return canWriteDocs && detail.access === 'write' && detail.doc.archivedAt === null;
}

function LoadedDoc({
  detail,
  canWriteDocs,
  canPublish,
}: DocSurfaceProps & { readonly detail: DocDetail }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const { docs, collections, projects } = useDocList();
  const { toggle, setUnsavedDocId } = useDocsTree();
  const update = useUpdateDoc(detail.doc.id);
  const archive = useArchiveDoc();
  const duplicate = useDuplicateDoc();
  const favorite = useToggleDocFavorite(detail.doc.id);
  const recordVisit = useRecordDocVisit().mutate;
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nesting, setNesting] = useState(false);
  const canWrite = docWriteAccess(canWriteDocs, detail);

  useEffect(() => recordVisit(detail.doc.id), [recordVisit, detail.doc.id]);

  const comments = useDocComments(detail.doc.id);
  const [anchorText, setAnchorText] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<DocCommentAnchor | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const revealRef = useRef<((commentId: string) => void) | null>(null);
  const targets = useMemo(() => anchorTargetsOf(comments.data ?? []), [comments.data]);

  const commenting = useMemo<DocCommenting>(
    () => ({
      targets,
      focusedCommentId,
      onSelectPassage: setFocusedCommentId,
      onTextChange: setAnchorText,
      onAnchorSelected: setPendingAnchor,
      revealRef,
    }),
    [targets, focusedCommentId],
  );

  useEffect(() => {
    setUnsavedDocId(canWrite && status !== 'saved' ? detail.doc.id : null);
    return () => setUnsavedDocId(null);
  }, [canWrite, status, detail.doc.id, setUnsavedDocId]);

  const collectionName =
    collections.find((entry) => entry.id === detail.doc.collectionId)?.name ?? null;
  const projectName = projects.find((entry) => entry.id === detail.doc.projectId)?.name ?? null;
  const trail = useMemo(
    () => breadcrumbOf(docs, collections, detail.doc.id),
    [docs, collections, detail.doc.id],
  );
  const blocked = useMemo(() => descendantIds(docs, detail.doc.id), [docs, detail.doc.id]);
  const parents = useMemo(() => docs.filter((entry) => !blocked.has(entry.id)), [docs, blocked]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DocHeader
        doc={detail.doc}
        trail={trail}
        collections={collections}
        favorite={detail.favorite}
        canWrite={canWrite}
        canWriteDocs={canWriteDocs}
        saveStatus={canWrite ? STATUS_LABEL[status] : null}
        saveFailed={status === 'error'}
        onToggleTree={toggle}
        onToggleFavorite={() => favorite.mutate(!detail.favorite)}
        onMoveToCollection={(collectionId) => update.mutate({ collectionId })}
        onDuplicate={() => {
          duplicate.mutate(detail.doc.id, {
            onSuccess: (copy) => router.push(`/docs/${copy.id}`),
          });
        }}
        onOpenNestPicker={() => setNesting(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onArchive={() => {
          archive.mutate(detail.doc.id);
          router.push('/docs');
        }}
        onNewDoc={() =>
          router.push(
            newDocPath({
              collectionId: detail.doc.collectionId,
              projectId: detail.doc.projectId,
            }),
          )
        }
        share={
          canWrite ? (
            <DocShareMenu
              doc={detail.doc}
              canPublish={canPublish}
              canManageAccess={canPublish || detail.doc.authorId === workspace.userId}
            />
          ) : null
        }
      />

      <DocHistory
        docId={detail.doc.id}
        canWrite={canWrite}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />

      <NestPickerDialog
        open={nesting}
        onOpenChange={setNesting}
        parents={parents}
        currentParentId={detail.doc.parentId}
        onSelect={(parentId) => {
          update.mutate({ parentId });
          setNesting(false);
        }}
      />

      {canWrite ? (
        <EditSession
          doc={detail.doc}
          save={update.mutateAsync}
          onStatusChange={setStatus}
          commenting={commenting}
          footer={
            <div className={isHtmlDoc(detail.doc.kind) ? '' : 'mt-10 border-border border-t pt-6'}>
              <DocAttachments attachments={detail.attachments} />
              <DocBacklinks backlinks={detail.backlinks} />
              <DocComments
                docId={detail.doc.id}
                members={workspace.members}
                anchorText={anchorText}
                pendingAnchor={pendingAnchor}
                onPendingAnchorChange={setPendingAnchor}
                focusedCommentId={focusedCommentId}
                onRevealPassage={(commentId) => revealRef.current?.(commentId)}
              />
            </div>
          }
        />
      ) : (
        <ReadOnlyDoc
          detail={detail}
          collectionName={collectionName}
          projectName={projectName}
          members={workspace.members}
        />
      )}
    </div>
  );
}

export function NestPickerDialog({
  open,
  onOpenChange,
  parents,
  currentParentId,
  onSelect,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly parents: readonly DocSummary[];
  readonly currentParentId: string | null;
  readonly onSelect: (parentId: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-2 p-0">
        <DialogTitle className="px-3 pt-3 text-dense">Nest under a page</DialogTitle>
        <NestPickerList parents={parents} currentParentId={currentParentId} onSelect={onSelect} />
      </DialogContent>
    </Dialog>
  );
}

const nestItemClassName =
  'flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 text-left text-dense text-muted outline-none transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] data-[selected=true]:bg-surface-2 data-[selected=true]:text-text';

export function NestPickerList({
  parents,
  currentParentId,
  onSelect,
}: {
  readonly parents: readonly DocSummary[];
  readonly currentParentId: string | null;
  readonly onSelect: (parentId: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = 'nest-under-list';
  const { shown, hiddenCount } = matchParents(parents, search, NEST_PICKER_LIMIT);

  const options: readonly { readonly id: string | null; readonly label: string }[] = [
    { id: null, label: 'Top level' },
    ...shown.map((entry) => ({ id: entry.id, label: entry.title })),
  ];
  const activeIndex = Math.min(active, options.length - 1);

  const choose = (parentId: string | null) => {
    onSelect(parentId);
    setSearch('');
    setActive(0);
  };

  const optionId = (id: string | null) => (id === null ? 'nest-under-none' : `nest-under-${id}`);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) choose(option.id);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 border-border border-b px-2.5">
        <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        <input
          ref={inputRef}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setActive(event.target.value.trim().length > 0 ? 1 : 0);
          }}
          onKeyDown={onKeyDown}
          data-testid="doc-parent-search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={optionId(options[activeIndex]?.id ?? null)}
          aria-label="Search docs to nest under"
          placeholder="Search docs..."
          className="h-9 w-full bg-transparent text-dense text-text outline-none placeholder:text-faint"
        />
      </div>
      <div id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
        {options.map((option, index) => (
          <button
            key={option.id ?? '__top_level__'}
            type="button"
            id={optionId(option.id)}
            role="option"
            aria-selected={index === activeIndex}
            data-selected={index === activeIndex}
            data-testid={optionId(option.id)}
            className={nestItemClassName}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(option.id)}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {currentParentId === option.id ? (
              <Check className="size-3.5 text-accent" aria-hidden="true" />
            ) : null}
          </button>
        ))}
        {hiddenCount > 0 ? (
          <p className="px-2 py-1.5 text-2xs text-faint">
            Showing the first {NEST_PICKER_LIMIT}. Refine your search to see more.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReadOnlyDoc({
  detail,
  collectionName,
  projectName,
  members,
}: {
  readonly detail: DocDetail;
  readonly collectionName: string | null;
  readonly projectName: string | null;
  readonly members: readonly Member[];
}) {
  if (isHtmlDoc(detail.doc.kind)) {
    return <HtmlDocReader title={detail.doc.title} content={detail.doc.content} />;
  }

  return (
    <div className="min-h-0 flex-1 scroll-smooth overflow-y-auto motion-reduce:scroll-auto">
      <DocReader
        doc={detail.doc}
        contentHtml={detail.contentHtml}
        attachments={detail.attachments}
        author={detail.author}
        followers={detail.followers}
        collectionName={collectionName}
        projectName={projectName}
        backlinks={detail.backlinks}
      />
      <DocComments docId={detail.doc.id} members={members} />
    </div>
  );
}

function EditSession({
  doc,
  save,
  onStatusChange,
  commenting,
  footer,
}: {
  readonly doc: Doc;
  readonly save: (patch: DocPatch) => Promise<unknown>;
  readonly onStatusChange: (status: SaveStatus) => void;
  readonly commenting: DocCommenting;
  readonly footer?: React.ReactNode;
}) {
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const draft = useMemo(() => ({ title, content }), [title, content]);
  const autosave = useAutosave({
    value: draft,
    save,
    canSave: (next) => next.content.length <= DOC_CONTENT_LIMIT,
  });
  const flush = autosave.saveNow;
  const over = content.length > DOC_CONTENT_LIMIT;
  const near = content.length > NEAR_LIMIT;
  const settled = autosave.status === 'saved';
  const server = useRef({ title: doc.title, content: doc.content });
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const outline = useEditorOutline(isHtmlDoc(doc.kind) ? '' : content, scroller);

  useEffect(() => onStatusChange(autosave.status), [autosave.status, onStatusChange]);
  useEffect(() => flush, [flush]);

  useEffect(() => {
    const incoming = { title: doc.title, content: doc.content };
    if (!adoptsRemoteEdit(settled, server.current, incoming)) return;
    server.current = incoming;
    setTitle(incoming.title);
    setContent(incoming.content);
  }, [doc.title, doc.content, settled]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col px-6 pt-2 pb-0">
        <Input
          value={title}
          aria-label="Doc title"
          data-testid="doc-title-input"
          onChange={(event) => setTitle(event.target.value)}
          className="h-auto rounded-sm border-0 bg-transparent px-0 py-0 font-semibold text-text text-2xl outline-none focus-visible:border-0 focus-visible:bg-surface-2/60"
        />
      </div>
      {isHtmlDoc(doc.kind) ? (
        <HtmlDocEditor title={title} content={content} onChange={setContent} footer={footer} />
      ) : (
        <DocEditor
          docId={doc.id}
          content={content}
          onChange={setContent}
          onForceSave={flush}
          commenting={commenting}
          footer={footer}
          scrollRef={setScroller}
          outline={outline}
        />
      )}
      {near ? (
        <p
          data-testid="doc-length-warning"
          className={cn(
            'shrink-0 border-border border-t px-6 py-2 text-2xs tabular-nums',
            over ? 'text-danger' : 'text-muted',
          )}
        >
          {over
            ? `This document is ${content.length.toLocaleString()} characters, past the ${DOC_CONTENT_LIMIT.toLocaleString()} limit. Nothing is being saved until it is shorter. Split it into linked pages.`
            : `${content.length.toLocaleString()} of ${DOC_CONTENT_LIMIT.toLocaleString()} characters.`}
        </p>
      ) : null}
    </div>
  );
}
