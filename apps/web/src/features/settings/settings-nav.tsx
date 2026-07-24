'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn.ts';

export interface SettingsSection {
  readonly href: string;
  readonly label: string;
}

export interface SettingsGroup {
  readonly id: string;
  readonly title: string;
  readonly sections: readonly SettingsSection[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'account',
    title: 'Account',
    sections: [
      { href: '/settings/account', label: 'Profile' },
      { href: '/settings/account/connections', label: 'Connected accounts' },
      { href: '/settings/account/passkeys', label: 'Passkeys' },
      { href: '/settings/account/sessions', label: 'Sessions' },
    ],
  },
  {
    id: 'workspace',
    title: 'Workspace',
    sections: [
      { href: '/settings/general', label: 'General' },
      { href: '/settings/members', label: 'Members' },
      { href: '/settings/teams', label: 'Teams' },
      { href: '/settings/notifications', label: 'Notifications' },
      { href: '/settings/integrations', label: 'Integrations' },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-4 sm:flex-row sm:gap-8">
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="px-2 font-medium text-2xs text-faint uppercase tracking-wide">
            {group.title}
          </p>
          <ul className="flex flex-wrap gap-1">
            {group.sections.map((section) => {
              const active = pathname === section.href;
              return (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-2 py-1 text-dense transition-colors duration-[var(--duration-fast)]',
                      active
                        ? 'bg-surface-2 font-medium text-text'
                        : 'text-muted hover:bg-surface-2 hover:text-text',
                    )}
                  >
                    {section.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
