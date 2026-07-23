import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { serverEnv } from '@/lib/env.ts';
import { Providers } from './providers.tsx';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(serverEnv().NEXT_PUBLIC_APP_URL),
  title: {
    default: 'Orbit',
    template: '%s · Orbit',
  },
  description: 'Realtime, keyboard-first work tracking.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0c10' },
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
