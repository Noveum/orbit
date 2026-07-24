'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Collapsible } from '@/components/ui/collapsible.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import type { NavLink, NavTeamNode } from '@/lib/navigation.ts';

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function CountBadge({ count }: { readonly count: number }) {
  return (
    <span
      data-numeric
      className="shrink-0 rounded-xs bg-surface-3 px-1 text-2xs text-muted leading-4"
    >
      {count}
    </span>
  );
}

interface ChildItemProps {
  readonly link: NavLink;
  readonly touch: boolean;
  readonly onNavigate: (() => void) | null;
}

function ChildItem({ link, touch, onNavigate }: ChildItemProps) {
  const pathname = usePathname();
  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      {...(onNavigate === null ? {} : { onClick: onNavigate })}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 text-dense',
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
        touch ? 'h-10' : 'h-7 3xl:h-8',
        active
          ? 'bg-surface-2 font-medium text-text'
          : 'text-muted hover:bg-surface-2/70 hover:text-text',
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{link.label}</span>
      {typeof link.count === 'number' && link.count > 0 ? <CountBadge count={link.count} /> : null}
    </Link>
  );
}

export interface SidebarTeamProps {
  readonly team: NavTeamNode;
  readonly open: boolean;
  readonly collapsed: boolean;
  readonly touch: boolean;
  readonly onToggle: () => void;
  readonly onNavigate: (() => void) | null;
}

export function SidebarTeam({
  team,
  open,
  collapsed,
  touch,
  onToggle,
  onNavigate,
}: SidebarTeamProps) {
  const pathname = usePathname();
  const base = `/team/${team.key.toLowerCase()}`;
  const withinTeam = pathname === base || pathname.startsWith(`${base}/`);

  const tile = (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded-sm font-semibold text-[9px] text-white"
      style={{ backgroundColor: team.color }}
      aria-hidden="true"
    >
      {initial(team.name)}
    </span>
  );

  if (collapsed) {
    const link = (
      <Link
        href={team.href}
        aria-current={withinTeam ? 'page' : undefined}
        {...(onNavigate === null ? {} : { onClick: onNavigate })}
        className={cn(
          'flex h-7 items-center justify-center rounded-md 3xl:h-8',
          'transition-colors duration-[var(--duration-fast)]',
          withinTeam ? 'bg-surface-2' : 'hover:bg-surface-2/70',
        )}
      >
        {tile}
      </Link>
    );
    return touch ? (
      link
    ) : (
      <Tooltip label={team.name} side="right">
        {link}
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'group flex w-full items-center gap-2 rounded-md px-2 text-dense',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
          touch ? 'h-11 gap-3 px-3' : 'h-7 3xl:h-8',
          withinTeam && !open ? 'text-text' : 'text-muted',
          'hover:bg-surface-2/70 hover:text-text',
        )}
      >
        {tile}
        <span className="min-w-0 flex-1 truncate text-left font-medium">{team.name}</span>
        {!open && typeof team.count === 'number' && team.count > 0 ? (
          <CountBadge count={team.count} />
        ) : null}
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-faint transition-transform duration-[var(--duration-fast)]',
            open && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      <Collapsible open={open}>
        <div className="relative mt-0.5 mb-1 flex flex-col gap-0.5 pl-6">
          <div className="absolute top-0 bottom-1 left-[15px] w-px bg-border" aria-hidden="true" />
          {team.children.map((child) => (
            <ChildItem key={child.href} link={child} touch={touch} onNavigate={onNavigate} />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
