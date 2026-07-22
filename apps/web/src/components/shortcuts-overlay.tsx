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
import { formatBinding, useHotkeyList } from '@/lib/keyboard/index.ts';

export interface ShortcutsOverlayProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps) {
  const entries = useHotkeyList();
  const sections = new Map<string, { binding: string; label: string }[]>();

  for (const entry of entries) {
    const bucket = sections.get(entry.section);
    const item = { binding: entry.binding, label: entry.label };
    if (bucket === undefined) sections.set(entry.section, [item]);
    else bucket.push(item);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-muted text-xs">
            Press the keys in order. Sequences must be typed within 800ms.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-5 pr-2">
            {[...sections.entries()].map(([section, items]) => (
              <section key={section} className="flex flex-col gap-1">
                <h3 className="font-medium text-2xs text-faint uppercase tracking-wide">
                  {section}
                </h3>
                {items.map((item) => (
                  <div
                    key={`${section}-${item.binding}`}
                    className="flex items-center justify-between gap-4 rounded-sm px-1 py-1 text-dense"
                  >
                    <span className="min-w-0 truncate text-muted">{item.label}</span>
                    <Kbd keys={formatBinding(item.binding)} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
