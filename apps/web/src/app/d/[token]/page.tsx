import { getPublishedDoc } from '@orbit/core';
import { renderMarkdown } from '@orbit/services/markdown';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocReader } from '@/features/docs/doc-reader.tsx';

interface PageProps {
  readonly params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const detail = await getPublishedDoc(token);
  if (detail === null) return { title: 'Doc not found' };
  return {
    title: detail.doc.title,
    robots: detail.doc.visibility === 'public' ? undefined : { index: false, follow: false },
  };
}

export default async function PublishedDocPage({ params }: PageProps) {
  const { token } = await params;
  const detail = await getPublishedDoc(token);
  if (detail === null) notFound();

  return (
    <main className="min-h-dvh bg-bg" data-testid="published-doc">
      <div className="border-border border-b">
        <div className="mx-auto flex h-11 w-full max-w-[68rem] items-center justify-between px-6">
          <span className="font-medium text-dense text-text">Orbit</span>
          <span className="text-2xs text-faint">Published doc, read only</span>
        </div>
      </div>
      <DocReader
        doc={{
          ...detail.doc,
          createdAt: detail.doc.createdAt.toISOString(),
          updatedAt: detail.doc.updatedAt.toISOString(),
          archivedAt: null,
          publishToken: null,
        }}
        contentHtml={renderMarkdown(detail.doc.content)}
        attachments={detail.attachments.map((attachment) => ({
          id: attachment.id,
          parentType: attachment.parentType,
          parentId: attachment.parentId,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          size: attachment.size,
          storageKey: attachment.storageKey,
          status: attachment.status,
        }))}
        author={detail.author}
        followers={detail.followers}
        collectionName={null}
        projectName={null}
      />
    </main>
  );
}
