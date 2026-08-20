import { isHtmlDoc } from '@orbit/shared/constants';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DocReader } from '@/features/docs/doc-reader.tsx';
import {
  isIndexable,
  type PublishedDocSeoInput,
  publishedDocJsonLd,
  publishedDocMetadata,
} from '@/features/docs/published-doc-meta.ts';
import { publicDocPath } from '@/lib/docs/paths.ts';
import { loadPublishedDoc, lookupPublishedDoc } from '@/lib/docs/published.ts';
import { renderedDocHtml, summarizeDoc } from '@/lib/docs/render.ts';
import { serverEnv } from '@/lib/env.ts';

interface PageProps {
  readonly params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

function publishedBanner(visibility: string): string {
  if (isIndexable(visibility)) return 'Published doc, read only';
  if (visibility === 'members') return 'Members only, read only';
  return 'Unlisted, read only';
}

async function seoFor(token: string): Promise<PublishedDocSeoInput | 'sign-in' | null> {
  const result = await lookupPublishedDoc(token);
  if (result.status === 'sign-in') return 'sign-in';
  if (result.status === 'missing') return null;
  const { detail } = result;
  return {
    title: detail.doc.title,
    summary: summarizeDoc(detail.doc.kind, detail.doc.content, 180),
    visibility: detail.doc.visibility,
    slug: detail.doc.slug,
    kind: detail.doc.kind,
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
  if (seo === 'sign-in') return { title: 'Sign in', robots: { index: false, follow: false } };
  if (seo === null) return { title: 'Doc not found', robots: { index: false, follow: false } };
  return publishedDocMetadata(seo);
}

export default async function PublishedDocPage({ params }: PageProps) {
  const { token } = await params;
  const detail = await loadPublishedDoc(token, `/d/${token}`);

  const canonicalPath = publicDocPath(detail.doc);
  if (canonicalPath !== null && canonicalPath !== `/d/${token}`) {
    redirect(canonicalPath);
  }

  const jsonLd = publishedDocJsonLd({
    title: detail.doc.title,
    summary: summarizeDoc(detail.doc.kind, detail.doc.content, 180),
    visibility: detail.doc.visibility,
    slug: detail.doc.slug,
    kind: detail.doc.kind,
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
          <span className="text-2xs text-faint">{publishedBanner(detail.doc.visibility)}</span>
        </div>
      </div>
      <DocReader
        doc={{
          ...detail.doc,
          createdAt: detail.doc.createdAt.toISOString(),
          updatedAt: detail.doc.updatedAt.toISOString(),
          archivedAt: null,
          publishToken: null,
          kind: isHtmlDoc(detail.doc.kind) ? 'html' : 'markdown',
        }}
        contentHtml={renderedDocHtml(detail.doc.kind, detail.doc.content)}
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
