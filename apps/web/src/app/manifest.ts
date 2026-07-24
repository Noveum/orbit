import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbit',
    short_name: 'Orbit',
    description: 'Free, realtime, keyboard-first work tracker.',
    start_url: '/',
    display: 'standalone',
    background_color: '#07070b',
    theme_color: '#07070b',
    icons: [
      { src: '/icon.png', sizes: '256x256', type: 'image/png' },
      { src: '/logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
