'use client';

import { relativeTime } from '@orbit/shared/utils';
import { Book, GitBranch, Link2, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import type { Attachment, Doc } from '@/lib/query/schemas.ts';
import { DocAttachments } from './doc-attachments.tsx';
import { DocBody } from './doc-body.tsx';
import { DocOutline } from './doc-outline.tsx';
import type { DocHeading } from './outline.ts';
import { readTimeMinutes } from './outline.ts';
import { useScrollSpy } from './use-scroll-spy.ts';

export interface DocReaderProps {
  readonly doc: Doc;
  readonly contentHtml: string;
  readonly attachments: readonly Attachment[];
  readonly author: { readonly name: string; readonly image: string | null };
  readonly followers: number;
  readonly collectionName: string | null;
  readonly projectName: string | null;
  readonly backlinks?: readonly { readonly id: string; readonly title: string }[];
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-2xs text-muted">
      {children}
    </span>
  );
}

export function DocReader({
  doc,
  contentHtml,
  attachments,
  author,
  followers,
  collectionName,
  projectName,
  backlinks = [],
}: DocReaderProps) {
  const [headings, setHeadings] = useState<DocHeading[]>([]);
  const activeId = useScrollSpy(headings);
  const binding = doc.repoBinding;

  return (
    <article
      className="mx-auto flex w-full max-w-[68rem] gap-10 px-6 py-10"
      data-testid="doc-reader"
    >
      <div className="min-w-0 flex-1 xl:max-w-[45rem]">
        <div className="flex flex-wrap items-center gap-2">
          {collectionName === null ? null : (
            <Pill>
              <Book className="size-3" aria-hidden="true" />
              {collectionName}
            </Pill>
          )}
          {projectName === null ? null : <Pill>{projectName}</Pill>}
          {binding === null ? null : (
            <span
              data-testid="doc-repo-pill"
              className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-transparent px-2.5 py-1 text-2xs text-success"
            >
              <GitBranch className="size-3" aria-hidden="true" />
              Synced from <code className="font-mono">{binding.path}</code>
            </span>
          )}
          <span className="text-2xs text-faint">
            Updated {relativeTime(new Date(doc.updatedAt))}
          </span>
        </div>

        <h1 className="mt-4 font-semibold text-2xl text-text tracking-tight">{doc.title}</h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-border border-b pb-5 text-2xs text-faint">
          <span className="flex items-center gap-1.5">
            <Avatar name={author.name} src={author.image} size="sm" />
            <span className="text-muted">{author.name}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>{readTimeMinutes(doc.content)} min read</span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            <Users className="size-3" aria-hidden="true" />
            {followers} following
          </span>
        </div>

        <DocBody html={contentHtml} onHeadings={setHeadings} className="mt-2" />
        <DocAttachments attachments={attachments} />

        {backlinks.length === 0 ? null : (
          <section data-testid="doc-backlinks" className="mt-10 border-border border-t pt-5">
            <h2 className="mb-2 font-medium text-2xs text-faint uppercase tracking-wide">
              Linked from
            </h2>
            <ul className="flex flex-col gap-1">
              {backlinks.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/docs/${entry.id}`}
                    className="flex items-center gap-2 text-dense text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                  >
                    <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{entry.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <DocOutline headings={headings} activeId={activeId} />
    </article>
  );
}
