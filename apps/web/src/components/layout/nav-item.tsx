'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import type { NavLink } from '@/lib/navigation.ts';

export interface NavItemProps {
  readonly link: NavLink;
  readonly collapsed: boolean;
  readonly onNavigate?: () => void;
}

export function NavItem({ link, collapsed, onNavigate }: NavItemProps) {
  const pathname = usePathname();
  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
  const Icon = link.icon;

  const anchor = (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      className={cn(
        'group flex h-9 items-center gap-2 rounded-md px-2 text-dense sm:h-7',
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
        active
          ? 'bg-surface-2 font-medium text-text'
          : 'text-muted hover:bg-surface-2/70 hover:text-text',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate">{link.label}</span>
          {typeof link.count === 'number' && link.count > 0 ? (
            <span
              data-numeric
              className="shrink-0 rounded-xs bg-surface-3 px-1 text-2xs text-muted leading-4"
            >
              {link.count}
            </span>
          ) : null}
        </>
      )}
    </Link>
  );

  return (
    <Tooltip
      label={link.label}
      side="right"
      {...(link.shortcut === undefined ? {} : { shortcut: link.shortcut })}
    >
      {anchor}
    </Tooltip>
  );
}
