import type { Metadata } from 'next';
import { publicDocPath } from '@/lib/docs/paths.ts';

export interface PublishedDocSeoInput {
  readonly title: string;
  readonly summary: string;
  readonly visibility: string;
  readonly slug: string;
  readonly publishToken: string | null;
  readonly updatedAt: Date;
  readonly createdAt: Date;
  readonly authorName: string;
  readonly origin: string;
}

export function isIndexable(visibility: string): boolean {
  return visibility === 'public';
}

export function canonicalDocUrl(input: PublishedDocSeoInput): string | null {
  const path = publicDocPath({ slug: input.slug, publishToken: input.publishToken });
  return path === null ? null : new URL(path, input.origin).toString();
}

export function publishedDocMetadata(input: PublishedDocSeoInput): Metadata {
  const canonical = canonicalDocUrl(input);
  const indexable = isIndexable(input.visibility);

  if (!indexable) {
    return {
      title: input.title,
      description: input.summary,
      robots: { index: false, follow: false, nocache: true },
      alternates: canonical === null ? {} : { canonical },
      openGraph: { title: input.title, description: input.summary, type: 'article' },
    };
  }

  return {
    title: input.title,
    description: input.summary,
    robots: { index: true, follow: true },
    alternates: canonical === null ? {} : { canonical },
    openGraph: {
      title: input.title,
      description: input.summary,
      type: 'article',
      siteName: 'Orbit',
      publishedTime: input.createdAt.toISOString(),
      modifiedTime: input.updatedAt.toISOString(),
      authors: [input.authorName],
      ...(canonical === null ? {} : { url: canonical }),
    },
    twitter: { card: 'summary_large_image', title: input.title, description: input.summary },
  };
}

export function publishedDocJsonLd(input: PublishedDocSeoInput): string | null {
  if (!isIndexable(input.visibility)) return null;
  const canonical = canonicalDocUrl(input);

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.summary,
    datePublished: input.createdAt.toISOString(),
    dateModified: input.updatedAt.toISOString(),
    author: { '@type': 'Person', name: input.authorName },
    ...(canonical === null ? {} : { mainEntityOfPage: canonical, url: canonical }),
  });
}
