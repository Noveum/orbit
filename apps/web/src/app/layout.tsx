import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { serverEnv } from '@/lib/env.ts';
import { Providers } from './providers.tsx';
import './globals.css';

const DESCRIPTION =
  'Orbit is a free, realtime, keyboard-first work tracker for teams: issues, boards, cycles, projects, and docs that sync instantly for everyone. No pricing, no paid tiers, ever.';

const OG_IMAGE = {
  url: '/og.png',
  width: 2400,
  height: 1260,
  alt: 'Orbit: issue tracking at the speed of typing.',
};

export const metadata: Metadata = {
  metadataBase: new URL(serverEnv().NEXT_PUBLIC_APP_URL),
  title: {
    default: 'Orbit: the free, realtime, keyboard-first work tracker',
    template: '%s · Orbit',
  },
  description: DESCRIPTION,
  applicationName: 'Orbit',
  keywords: [
    'work tracker',
    'issue tracking',
    'project management',
    'realtime',
    'keyboard-first',
    'cycles',
    'sprints',
    'kanban',
    'docs',
    'Slack integration',
    'GitHub integration',
    'MCP',
    'free',
    'open source',
  ],
  authors: [{ name: 'Orbit' }],
  creator: 'Orbit',
  publisher: 'Orbit',
  appleWebApp: { capable: true, title: 'Orbit', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'Orbit',
    title: 'Orbit: the free, realtime, keyboard-first work tracker',
    description: DESCRIPTION,
    locale: 'en_US',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Orbit: the free, realtime, keyboard-first work tracker',
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#060607' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-bg text-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
