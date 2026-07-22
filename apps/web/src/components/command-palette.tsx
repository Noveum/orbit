'use client';

import { Command } from 'cmdk';
import { Moon, PanelLeft, Search, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import type { NavSection } from '@/lib/navigation.ts';

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sections: readonly NavSection[];
  readonly onToggleSidebar: () => void;
}

const itemClassName =
  'flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-dense text-muted outline-none data-[selected=true]:bg-surface-2 data-[selected=true]:text-text';

export function CommandPalette({
  open,
  onOpenChange,
  sections,
  onToggleSidebar,
}: CommandPaletteProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="top-[12vh] max-w-xl translate-y-0 p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          loop
          className="flex flex-col overflow-hidden"
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <div className="flex items-center gap-2 border-border border-b px-3">
            <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
            <Command.Input
              autoFocus
              placeholder="Type a command or search"
              className="h-11 w-full bg-transparent text-base text-text outline-none placeholder:text-faint"
            />
            <Kbd keys={['escape']} />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="px-2.5 py-6 text-center text-muted text-dense">
              No matching commands.
            </Command.Empty>
            {sections.map((section) => (
              <Command.Group
                key={section.id}
                heading={section.title ?? 'Jump to'}
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase"
              >
                {section.links.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Command.Item
                      key={link.href}
                      value={`${section.title ?? ''} ${link.label} ${link.href}`}
                      className={itemClassName}
                      onSelect={() => run(() => router.push(link.href))}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <span className="flex-1 truncate">{link.label}</span>
                      {link.shortcut ? <Kbd keys={link.shortcut} /> : null}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
            <Command.Group
              heading="General"
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase"
            >
              <Command.Item
                value="toggle sidebar"
                className={itemClassName}
                onSelect={() => run(onToggleSidebar)}
              >
                <PanelLeft className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="flex-1">Toggle sidebar</span>
                <Kbd keys={['[']} />
              </Command.Item>
              <Command.Item
                value="toggle theme dark light"
                className={itemClassName}
                onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Moon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                )}
                <span className="flex-1">Toggle theme</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
