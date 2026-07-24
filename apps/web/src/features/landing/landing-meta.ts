import type { Metadata } from 'next';
import { absoluteUrl, publicAppUrl } from '@/lib/env.ts';

const TITLE = 'Orbit: the free, realtime, keyboard-first work tracker';
const DESCRIPTION =
  'Orbit is a free, realtime, keyboard-first work tracker for teams: issues, boards, cycles, projects, and docs that sync instantly for everyone. No pricing, no paid tiers, ever.';

function ogImage() {
  return {
    url: absoluteUrl('/og.png'),
    width: 2400,
    height: 1260,
    alt: 'Orbit: issue tracking at the speed of typing.',
  };
}

export function landingMetadata(canonicalPath: string): Metadata {
  const canonical = absoluteUrl(canonicalPath);
  const image = ogImage();
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      url: canonical,
      siteName: 'Orbit',
      title: TITLE,
      description: DESCRIPTION,
      locale: 'en_US',
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      images: [image],
    },
  };
}

export function landingStructuredData(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Orbit',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: publicAppUrl(),
    logo: absoluteUrl('/logo.png'),
    image: absoluteUrl('/og.png'),
    description: DESCRIPTION,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      'Issues and boards',
      'Cycles and sprints',
      'Projects',
      'Docs with a rich editor',
      'Realtime sync over WebSockets',
      'Command palette and keyboard shortcuts',
      'Filters and saved views',
      'GitHub integration',
      'Slack integration',
      'Notifications',
      'MCP server for agents',
    ],
  });
}
