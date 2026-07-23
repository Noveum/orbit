import type { MetadataRoute } from 'next';
import { serverEnv } from '@/lib/env.ts';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = serverEnv().NEXT_PUBLIC_APP_URL;
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/login`, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
