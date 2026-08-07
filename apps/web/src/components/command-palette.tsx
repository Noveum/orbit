'use client';

import { Command } from 'cmdk';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CircleDot, FileText, Search, SlidersHorizontal, Terminal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useMemo, useState } from 'react';
import { resolvedHotkeys, SECTION_ORDER } from '@/components/shortcuts-overlay.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { MatchedText } from '@/features/docs/search-highlight.tsx';
import { IssueLink, isPlainClick, issueHref } from '@/features/issues/issue-link.tsx';
import { cn } from '@/lib/cn.ts';
import {
  formatBinding,
  type HotkeyEntry,
  type HotkeySection,
  useHotkey,
  useHotkeyList,
} from '@/lib/keyboard/index.ts';
import { type AppCommand, buildCommands, type NavSection } from '@/lib/navigation.ts';
import { useDocSearch } from '@/lib/query/use-doc-search.ts';
import { useIssueSearch } from '@/lib/query/use-issue-search.ts';

const PALETTE_BINDING = 'mod+k';
const DISMISS_BINDING = 'escape';

const SECTION_ICONS: Record<HotkeySection, LucideIcon> = {
  Navigation: ArrowRight,
  Issues: CircleDot,
  View: SlidersHorizontal,
  General: Terminal,
};

interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly section: HotkeySection;
  readonly icon: LucideIcon;
  readonly binding: string | undefined;
  readonly run: () => void;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sections: readonly NavSection[];
  readonly onToggleSidebar: () => void;
  readonly onShowShortcuts: () => void;
}

const itemClassName =
  'flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-dense text-muted outline-none transition-colors duration-[var(--duration-instant)] data-[selected=true]:bg-surface-2 data-[selected=true]:text-text data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50';

const groupClassName =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase';

function CommandBinding({
  binding,
  label,
  section,
  run,
}: {
  readonly binding: string;
  readonly label: string;
  readonly section: HotkeySection;
  readonly run: () => void;
}) {
  useHotkey(binding, run, { label, section });
  return null;
}

function replayEvent(entry: HotkeyEntry): KeyboardEvent {
  const step = entry.steps.at(-1);
  return new KeyboardEvent('keydown', {
    key: step?.key ?? '',
    metaKey: step?.mod ?? false,
    altKey: step?.alt ?? false,
    shiftKey: step?.shift ?? false,
  });
}

function contextEntries(
  entries: readonly HotkeyEntry[],
  ownedBindings: ReadonlySet<string>,
): PaletteEntry[] {
  const live = resolvedHotkeys(entries);
  return entries
    .filter(
      (entry) =>
        entry.enabled &&
        entry.advertised &&
        entry.binding !== DISMISS_BINDING &&
        !ownedBindings.has(entry.binding),
    )
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      section: entry.section,
      icon: SECTION_ICONS[entry.section],
      binding: live.includes(entry) ? entry.binding : undefined,
      run: () => entry.run(replayEvent(entry)),
    }));
}

export function CommandPalette({
  open,
  onOpenChange,
  sections,
  onToggleSidebar,
  onShowShortcuts,
}: CommandPaletteProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const registered = useHotkeyList();
  const [term, setTerm] = useState('');
  const { issues, searching } = useIssueSearch(open ? term : '');
  const { docs, searching: searchingDocs } = useDocSearch(open ? term : '');

  const commands = useMemo<AppCommand[]>(
    () =>
      buildCommands({
        sections,
        navigate: (href) => router.push(href),
        toggleSidebar: onToggleSidebar,
        toggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
        showShortcuts: onShowShortcuts,
        dark: resolvedTheme === 'dark',
      }),
    [sections, router, onToggleSidebar, onShowShortcuts, setTheme, resolvedTheme],
  );

  const owned = new Set([
    PALETTE_BINDING,
    ...commands.flatMap((command) => (command.binding === undefined ? [] : [command.binding])),
  ]);

  const entries: PaletteEntry[] = [
    ...commands.map((command) => ({ ...command, binding: command.binding })),
    ...contextEntries(registered, owned),
  ];

  useHotkey(PALETTE_BINDING, () => onOpenChange(true), {
    label: 'Open command palette',
    section: 'General',
  });

  const run = (entry: PaletteEntry) => {
    onOpenChange(false);
    entry.run();
  };

  const openIssue = (identifier: string) => {
    onOpenChange(false);
    router.push(issueHref(identifier));
  };

  const openDoc = (docId: string) => {
    onOpenChange(false);
    router.push(`/docs/${docId}`);
  };

  const dismissOnPlainClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (isPlainClick(event)) onOpenChange(false);
  };

  const needle = term.trim().toLowerCase();
  const matches = (entry: PaletteEntry) =>
    needle.length === 0 ||
    `${entry.section} ${entry.label} ${entry.binding ?? ''}`.toLowerCase().includes(needle);

  return (
    <>
      {commands.map((command) =>
        command.binding === undefined ? null : (
          <CommandBinding
            key={command.id}
            binding={command.binding}
            label={command.label}
            section={command.section}
            run={command.run}
          />
        ),
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setTerm('');
          onOpenChange(next);
        }}
      >
        <DialogContent
          showClose={false}
          aria-describedby={undefined}
          className="top-[12vh] max-w-xl translate-y-0 p-0"
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <Command loop shouldFilter={false} className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-border border-b px-3">
              <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <Command.Input
                autoFocus
                value={term}
                onValueChange={setTerm}
                placeholder="Search issues, or type a command"
                className="h-11 w-full bg-transparent text-base text-text outline-none placeholder:text-faint"
              />
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-1.5">
              <Command.Empty className="px-2.5 py-6 text-center text-muted text-dense">
                {searching || searchingDocs ? 'Searching…' : 'Nothing matches that.'}
              </Command.Empty>
              {issues.length === 0 ? null : (
                <Command.Group heading="Issues" className={groupClassName}>
                  {issues.map((issue) => (
                    <Command.Item
                      key={issue.id}
                      value={`issue-${issue.id}`}
                      className={itemClassName}
                      data-testid={`palette-issue-${issue.identifier}`}
                      onSelect={() => openIssue(issue.identifier)}
                    >
                      <IssueLink
                        identifier={issue.identifier}
                        onClick={dismissOnPlainClick}
                        prefetch={false}
                        tabIndex={-1}
                        className="flex min-w-0 flex-1 items-center gap-2.5"
                      >
                        <CircleDot
                          className="size-4 shrink-0"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        <span className="shrink-0 text-faint tabular-nums">{issue.identifier}</span>
                        <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                      </IssueLink>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {docs.length === 0 ? null : (
                <Command.Group heading="Docs" className={groupClassName}>
                  {docs.map((doc) => (
                    <Command.Item
                      key={doc.id}
                      value={`doc-${doc.id}`}
                      className={cn(itemClassName, 'h-auto flex-col items-stretch gap-0.5 py-1.5')}
                      data-testid={`palette-doc-${doc.id}`}
                      onSelect={() => openDoc(doc.id)}
                    >
                      <a
                        href={`/docs/${doc.id}`}
                        tabIndex={-1}
                        onClick={dismissOnPlainClick}
                        className="flex min-w-0 items-center gap-2.5"
                      >
                        <FileText
                          className="size-4 shrink-0"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                      </a>
                      {doc.snippet.length === 0 ? null : (
                        <span
                          data-testid={`palette-doc-snippet-${doc.id}`}
                          className="line-clamp-1 pl-6.5 text-2xs text-faint"
                        >
                          <MatchedText text={doc.snippet} term={term} />
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {SECTION_ORDER.map((section) => {
                const items = entries.filter(
                  (entry) => entry.section === section && matches(entry),
                );
                if (items.length === 0) return null;
                return (
                  <Command.Group key={section} heading={section} className={groupClassName}>
                    {items.map((entry) => {
                      const Icon = entry.icon;
                      return (
                        <Command.Item
                          key={entry.id}
                          value={`${section} ${entry.label} ${entry.binding ?? ''}`}
                          className={itemClassName}
                          onSelect={() => run(entry)}
                        >
                          <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                          <span className="flex-1 truncate">{entry.label}</span>
                          {entry.binding === undefined ? null : (
                            <Kbd keys={formatBinding(entry.binding)} />
                          )}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                );
              })}
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
