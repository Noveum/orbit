import { listPublicDocs } from '@orbit/core';
import type { MetadataRoute } from 'next';
import { publicDocPath } from '@/lib/docs/paths.ts';
import { serverEnv } from '@/lib/env.ts';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = serverEnv().NEXT_PUBLIC_APP_URL;
  const docs = await listPublicDocs();

  return docs.flatMap((doc) => {
    const path = publicDocPath(doc);
    if (path === null) return [];
    return [{ url: new URL(path, origin).toString(), lastModified: doc.updatedAt }];
  });
}
