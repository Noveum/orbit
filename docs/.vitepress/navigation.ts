import { readFileSync } from 'node:fs';
import type { DefaultTheme } from 'vitepress';

const tableLinkPattern = /^\|\s*[^|]+\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|$/;

export function documentationNavigation(): DefaultTheme.SidebarItem[] {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const items: DefaultTheme.SidebarItem[] = [{ text: 'Overview', link: '/' }];

  for (const line of readme.split('\n')) {
    const match = tableLinkPattern.exec(line);
    const text = match?.[1];
    const target = match?.[2];

    if (!(text && target)) continue;

    if (target.startsWith('https://') || target.startsWith('http://')) {
      items.push({ text, link: target });
      continue;
    }

    if (target.startsWith('../')) {
      items.push({
        text,
        link: `https://github.com/Noveum/orbit/blob/main/${target.slice(3)}`,
      });
      continue;
    }

    if (!target.endsWith('.md')) continue;

    items.push({
      text,
      link: `/${target.slice(0, -3)}`,
    });
  }

  return items;
}
