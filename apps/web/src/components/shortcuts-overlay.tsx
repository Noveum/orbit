'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { ScrollArea } from '@/components/ui/scroll-area.tsx';
import {
  type BufferedStep,
  formatBinding,
  type HotkeyEntry,
  type HotkeySection,
  SEQUENCE_TIMEOUT_MS,
  selectMatch,
  useHotkeyList,
} from '@/lib/keyboard/index.ts';

export const SECTION_ORDER: readonly HotkeySection[] = ['Navigation', 'Issues', 'View', 'General'];

function bufferFor(entry: HotkeyEntry): BufferedStep[] {
  return entry.steps.map((step, index) => ({ ...step, at: index }));
}

export function resolvedHotkeys(entries: readonly HotkeyEntry[]): HotkeyEntry[] {
  const live = entries.filter((entry) => entry.enabled);
  return live.filter(
    (entry) => entry.advertised && selectMatch(live, bufferFor(entry), false) === entry,
  );
}

export interface ShortcutsOverlayProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps) {
  const live = resolvedHotkeys(useHotkeyList());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-muted text-xs">
            Every shortcut listed is live on this screen. Sequences must be typed within{' '}
            {SEQUENCE_TIMEOUT_MS}ms.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-5 pr-2" data-testid="shortcuts-sections">
            {SECTION_ORDER.map((section) => {
              const items = live
                .filter((entry) => entry.section === section)
                .sort((left, right) => left.label.localeCompare(right.label));
              if (items.length === 0) return null;
              return (
                <section key={section} className="flex flex-col gap-1">
                  <h3 className="font-medium text-2xs text-faint uppercase tracking-wide">
                    {section}
                  </h3>
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 rounded-sm px-1 py-1 text-dense"
                    >
                      <span className="min-w-0 truncate text-muted">{item.label}</span>
                      <Kbd keys={formatBinding(item.binding)} />
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
