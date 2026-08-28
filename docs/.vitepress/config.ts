import { defineConfig } from 'vitepress';
import { documentationNavigation } from './navigation.ts';

const repository = 'https://github.com/Noveum/orbit';

export default defineConfig({
  lang: 'en-US',
  title: 'Orbit documentation',
  description: 'Documentation for the free, realtime, keyboard-first task manager.',
  base: '/orbit/',
  lastUpdated: true,
  srcExclude: ['superpowers/**'],
  rewrites: {
    'README.md': 'index.md',
  },
  ignoreDeadLinks: [/^http:\/\/localhost:/],
  themeConfig: {
    siteTitle: 'Orbit',
    nav: [
      { text: 'Product', link: 'https://orbit.noveum.ai' },
      { text: 'GitHub', link: repository },
    ],
    sidebar: [
      {
        text: 'Documentation',
        items: documentationNavigation(),
      },
    ],
    outline: {
      level: [2, 3],
      label: 'On this page',
    },
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: repository }],
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },
    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Copyright © Noveum',
    },
  },
});
