import { describe, expect, test } from 'bun:test';
import { documentationNavigation } from '../.vitepress/navigation.ts';

describe('documentationNavigation', () => {
  test('generates every sidebar entry and route from the documentation table', () => {
    expect(documentationNavigation()).toEqual([
      { text: 'Overview', link: '/' },
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Concepts', link: '/concepts' },
      { text: 'Self-hosting', link: '/self-hosting' },
      { text: 'Configuration', link: '/configuration' },
      { text: 'Keyboard shortcuts', link: '/keyboard-shortcuts' },
      { text: 'MCP server', link: '/mcp' },
      { text: 'Integrations', link: '/integrations' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Testing', link: '/testing' },
      { text: 'Troubleshooting', link: '/troubleshooting' },
      { text: 'Roadmap', link: '/roadmap' },
      {
        text: 'CONTRIBUTING.md',
        link: 'https://github.com/Noveum/orbit/blob/main/CONTRIBUTING.md',
      },
    ]);
  });
});
