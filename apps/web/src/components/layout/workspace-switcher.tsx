'use client';

import { ChevronsUpDown, LogOut, Settings, SunMoon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Avatar } from '@/components/ui/avatar.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { authClient } from '@/lib/auth/client.ts';
import { cn } from '@/lib/cn.ts';
import type { ShellUser, ShellWorkspace } from '@/lib/navigation.ts';

export interface WorkspaceSwitcherProps {
  readonly workspace: ShellWorkspace;
  readonly user: ShellUser;
  readonly collapsed: boolean;
}

export function WorkspaceSwitcher({ workspace, user, collapsed }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const handleSignOut = () => {
    authClient
      .signOut()
      .then(() => {
        router.push('/login');
        router.refresh();
      })
      .catch((error: unknown) => {
        console.error('Sign out failed', error);
      });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-dense',
          'transition-colors duration-[var(--duration-fast)] hover:bg-surface-2',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-accent font-semibold text-2xs text-accent-contrast">
          {workspace.name.slice(0, 1).toUpperCase()}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate font-medium text-text">{workspace.name}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar name={user.name} src={user.image ?? null} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium text-dense text-text">{user.name}</p>
            <p className="truncate text-2xs text-faint">{user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{workspace.slug}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <Settings className="size-4" aria-hidden="true" />
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          <SunMoon className="size-4" aria-hidden="true" />
          Toggle theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
