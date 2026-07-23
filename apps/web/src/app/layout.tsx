import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers.tsx';
import './globals.css';

export const metadata: Metadata = {
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
