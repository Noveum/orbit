import { getPublishedDoc } from '@orbit/core';
import { renderMarkdown, summarize } from '@orbit/services/markdown';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { DocReader } from '@/features/docs/doc-reader.tsx';
import {
  isIndexable,
  type PublishedDocSeoInput,
  publishedDocJsonLd,
  publishedDocMetadata,
} from '@/features/docs/published-doc-meta.ts';
import { publicDocPath } from '@/lib/docs/paths.ts';
import { serverEnv } from '@/lib/env.ts';

interface PageProps {
  readonly params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

async function seoFor(token: string): Promise<PublishedDocSeoInput | null> {
  const detail = await getPublishedDoc(token);
  if (detail === null) return null;
  return {
    title: detail.doc.title,
    summary: summarize(detail.doc.content, 180),
    visibility: detail.doc.visibility,
    slug: detail.doc.slug,
    publishToken: detail.doc.publishToken,
    createdAt: detail.doc.createdAt,
    updatedAt: detail.doc.updatedAt,
    authorName: detail.author.name,
    origin: serverEnv().NEXT_PUBLIC_APP_URL,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const seo = await seoFor(token);
  if (seo === null) return { title: 'Doc not found', robots: { index: false, follow: false } };
  return publishedDocMetadata(seo);
}

export default async function PublishedDocPage({ params }: PageProps) {
  const { token } = await params;
  const detail = await getPublishedDoc(token);
  if (detail === null) notFound();

  const canonicalPath = publicDocPath(detail.doc);
  if (
    canonicalPath !== null &&
    isIndexable(detail.doc.visibility) &&
    canonicalPath !== `/d/${token}`
  ) {
    redirect(canonicalPath);
  }

  const jsonLd = publishedDocJsonLd({
    title: detail.doc.title,
    summary: summarize(detail.doc.content, 180),
    visibility: detail.doc.visibility,
    slug: detail.doc.slug,
    publishToken: detail.doc.publishToken,
    createdAt: detail.doc.createdAt,
    updatedAt: detail.doc.updatedAt,
    authorName: detail.author.name,
    origin: serverEnv().NEXT_PUBLIC_APP_URL,
  });

  return (
    <main className="min-h-dvh bg-bg" data-testid="published-doc">
      {jsonLd === null ? null : (
        <script
          type="application/ld+json"
          data-testid="doc-json-ld"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: publishedDocJsonLd escapes < > and & so user fields cannot break out of the script tag
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      )}
      <div className="border-border border-b">
        <div className="mx-auto flex h-11 w-full max-w-[68rem] items-center justify-between px-6">
          <span className="font-medium text-dense text-text">Orbit</span>
          <span className="text-2xs text-faint">
            {isIndexable(detail.doc.visibility)
              ? 'Published doc, read only'
              : 'Unlisted, read only'}
          </span>
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
