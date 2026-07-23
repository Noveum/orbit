import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LandingPage } from '@/features/landing/landing-page.tsx';
import { getSession } from '@/lib/auth/session.ts';

const TITLE = 'Orbit: the free, realtime, keyboard-first work tracker';
const DESCRIPTION =
  'Orbit is a free, realtime, keyboard-first work tracker for teams: issues, boards, cycles, projects, and docs that sync instantly for everyone. No pricing, no paid tiers, ever.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    url: '/',
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

function structuredData(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Orbit',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://orbit.noveum.ai',
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

export default async function HomePage() {
  const session = await getSession();
  if (session !== null) redirect('/my-issues');

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants
        dangerouslySetInnerHTML={{ __html: structuredData() }}
      />
      <LandingPage />
    </>
  );
}
