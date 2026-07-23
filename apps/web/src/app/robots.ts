import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/env.ts';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/invite/'] }],
    sitemap: absoluteUrl('sitemap.xml'),
  };
}
