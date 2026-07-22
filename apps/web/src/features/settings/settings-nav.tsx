'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn.ts';

const SECTIONS = [
  { href: '/settings/general', label: 'General' },
  { href: '/settings/members', label: 'Members' },
  { href: '/settings/teams', label: 'Teams' },
  { href: '/settings/notifications', label: 'Notifications' },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex gap-1 border-border border-b">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-dense transition-colors duration-[var(--duration-fast)]',
              active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
