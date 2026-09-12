'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';
import { settingsGroupsFor } from './settings-sections.ts';
import { useSettingsNav } from './use-settings-nav.ts';
import { useSettingsSidebarNavigation } from './use-settings-sidebar-navigation.ts';

export interface SettingsSidebarProps {
  readonly passwordEnabled?: boolean;
}

export function SettingsSidebar({ passwordEnabled = false }: SettingsSidebarProps) {
  const pathname = usePathname();
  const { open, close } = useSettingsNav();
  const groups = settingsGroupsFor(passwordEnabled);
  const { sections, focusIndex, onLinkFocus, registerLinkRef } = useSettingsSidebarNavigation({
    passwordEnabled,
    pathname,
  });

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close settings sections"
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
          onClick={close}
        />
      ) : null}

      <nav
        aria-label="Settings sections"
        className={cn(
          'z-40 flex h-full w-64 shrink-0 flex-col gap-4 border-border border-r bg-surface p-3',
          open ? 'fixed inset-y-0 left-0 shadow-pop lg:static lg:shadow-none' : 'hidden lg:flex',
        )}
        data-testid="settings-sidebar"
      >
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            <p className="px-2 pt-1 font-medium text-2xs text-faint uppercase tracking-wide">
              {group.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.sections.map((section) => {
                const index = sections.findIndex((entry) => entry.href === section.href);
                const active = pathname === section.href;
                const focused = focusIndex === index;
                return (
                  <li key={section.href}>
                    <Link
                      ref={(node) => registerLinkRef(index, node)}
                      href={section.href}
                      aria-current={active ? 'page' : undefined}
                      data-keyboard-focus={focused ? 'true' : undefined}
                      onFocus={() => onLinkFocus(index)}
                      onClick={close}
                      className={cn(
                        'block rounded-md px-2 py-1.5 text-dense outline-none focus-visible:bg-surface-2 focus-visible:font-medium focus-visible:text-text',
                        tabHover,
                        active
                          ? 'bg-surface-2 font-medium text-text'
                          : 'text-muted hover:bg-surface-2',
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
    </>
  );
}
