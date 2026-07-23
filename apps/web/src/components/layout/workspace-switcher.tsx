'use client';

import { Check, ChevronsUpDown, LogOut, Plus, Settings, SunMoon, UserCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState } from 'react';
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
import { useToast } from '@/components/ui/toast.tsx';
import { authClient } from '@/lib/auth/client.ts';
import { cn } from '@/lib/cn.ts';
import type { ShellUser, ShellWorkspace } from '@/lib/navigation.ts';

export const WORKSPACE_LANDING = '/my-issues';

export interface WorkspaceSwitcherProps {
  readonly workspace: ShellWorkspace;
  readonly workspaces: readonly ShellWorkspace[];
  readonly user: ShellUser;
  readonly collapsed: boolean;
  readonly touch?: boolean;
}

export function WorkspaceSwitcher({
  workspace,
  workspaces,
  user,
  collapsed,
  touch = false,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme, setTheme } = useTheme();
  const [switching, setSwitching] = useState(false);

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

  const switchTo = async (target: ShellWorkspace): Promise<void> => {
    if (target.id === workspace.id || switching) return;
    setSwitching(true);
    try {
      const result = await authClient.organization.setActive({ organizationId: target.id });
      if (result.error) throw new Error(result.error.message ?? 'Could not switch workspace.');
      window.location.assign(WORKSPACE_LANDING);
    } catch (error: unknown) {
      toast({
        title: 'Could not switch workspace',
        description: error instanceof Error ? error.message : 'Try again.',
        tone: 'danger',
      });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="workspace-switcher"
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 text-left text-dense',
          'transition-colors duration-[var(--duration-fast)] hover:bg-surface-2',
          touch ? 'h-11 gap-3 px-3' : 'h-9 3xl:h-10',
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

        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((option) => {
          const active = option.id === workspace.id;
          return (
            <DropdownMenuItem
              key={option.id}
              data-testid={`workspace-option-${option.slug}`}
              aria-current={active ? 'true' : undefined}
              disabled={switching}
              onSelect={() => {
                switchTo(option);
              }}
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-surface-2 font-semibold text-[9px] text-muted">
                {option.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {active ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem
          data-testid="create-workspace"
          onSelect={() => router.push('/workspaces/new')}
        >
          <Plus className="size-4" aria-hidden="true" />
          Create workspace
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/settings/general')}>
          <Settings className="size-4" aria-hidden="true" />
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/settings/account')}>
          <UserCog className="size-4" aria-hidden="true" />
          Account settings
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
