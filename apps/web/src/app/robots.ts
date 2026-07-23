import type { MetadataRoute } from 'next';
import { serverEnv } from '@/lib/env.ts';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/invite/'] }],
    sitemap: `${serverEnv().NEXT_PUBLIC_APP_URL}/sitemap.xml`,
  };
}
