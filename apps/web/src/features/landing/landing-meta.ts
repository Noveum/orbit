import type { Metadata } from 'next';
import { absoluteUrl, publicAppUrl } from '@/lib/env.ts';

const TITLE = 'Orbit: the free, realtime, keyboard-first work tracker';
const DESCRIPTION =
  'Orbit is a free, realtime, keyboard-first work tracker for teams: issues, boards, cycles, projects, and docs that sync instantly for everyone. No pricing, no paid tiers, ever.';

export function landingMetadata(canonicalPath: string): Metadata {
  const canonical = absoluteUrl(canonicalPath);
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
    },
    twitter: {
      card: 'summary',
      title: TITLE,
      description: DESCRIPTION,
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
