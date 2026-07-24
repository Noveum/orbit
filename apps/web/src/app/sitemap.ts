import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/env.ts';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl('/'), changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/home'), changeFrequency: 'weekly', priority: 0.9 },
    { url: absoluteUrl('/login'), changeFrequency: 'monthly', priority: 0.5 },
  ];
}
