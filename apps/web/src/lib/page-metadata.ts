import type { Metadata } from 'next';

export const OG_IMAGE = {
  url: '/og.png',
  width: 2400,
  height: 1260,
  alt: 'Orbit: issue tracking at the speed of typing.',
};

export function pageMetadata(title: string, path: string): Metadata {
  const shared = `${title} · Orbit`;
  return {
    title,
    openGraph: { type: 'website', siteName: 'Orbit', title: shared, url: path, images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: shared, images: [OG_IMAGE] },
  };
}
