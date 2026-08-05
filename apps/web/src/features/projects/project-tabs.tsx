'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { cn } from '@/lib/cn.ts';

export const PROJECT_TABS = [
  { segment: null, label: 'Overview', href: '' },
  { segment: 'activity', label: 'Activity', href: '/activity' },
  { segment: 'issues', label: 'Issues', href: '/issues' },
] as const;

export function ProjectTabs({ slug }: { readonly slug: string }) {
  const segment = useSelectedLayoutSegment();

  return (
    <nav className="flex items-center gap-1" aria-label="Project sections">
      {PROJECT_TABS.map((tab) => {
        const active = segment === tab.segment;
        return (
          <Link
            key={tab.label}
            href={`/projects/${slug}${tab.href}`}
            data-testid={`project-tab-${tab.label.toLowerCase()}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1 text-2xs',
              'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
              active ? 'bg-surface-2 text-text' : 'text-faint hover:text-muted',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
