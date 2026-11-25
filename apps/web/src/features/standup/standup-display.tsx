'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu.tsx';

const memberLayoutSchema = z.enum(['auto', 'list', 'dropdown']);
export type MemberLayout = z.infer<typeof memberLayoutSchema>;

const workTypeSchema = z.enum(['assigned', 'reviewing', 'all']);
export type WorkType = z.infer<typeof workTypeSchema>;

const MEMBER_LAYOUT_OPTIONS: Readonly<
  Record<MemberLayout, { readonly label: string; readonly hint: string }>
> = {
  auto: { label: 'Auto', hint: 'A list when everyone fits on one line, a dropdown when not' },
  list: { label: 'List', hint: 'Always show every member, wrapping onto more lines' },
  dropdown: { label: 'Dropdown', hint: 'Always pick members from a dropdown' },
};

const WORK_TYPE_LABELS: Readonly<Record<WorkType, string>> = {
  assigned: 'Assigned',
  reviewing: 'To review',
  all: 'All work',
};

const standupDisplaySchema = z.object({
  memberLayout: memberLayoutSchema.catch('auto'),
  workType: workTypeSchema.catch('assigned'),
  aiOnly: z.boolean().catch(false),
});
export type StandupDisplay = z.infer<typeof standupDisplaySchema>;

export const DEFAULT_STANDUP_DISPLAY: StandupDisplay = {
  memberLayout: 'auto',
  workType: 'assigned',
  aiOnly: false,
};

export function standupDisplayKey(userId: string): string {
  return `orbit.standup.display.${userId}`;
}

function readStandupDisplay(key: string): StandupDisplay {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return DEFAULT_STANDUP_DISPLAY;
    const parsed = standupDisplaySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_STANDUP_DISPLAY;
  } catch {
    return DEFAULT_STANDUP_DISPLAY;
  }
}

export function isStandupDisplayModified(display: StandupDisplay): boolean {
  return (
    display.memberLayout !== DEFAULT_STANDUP_DISPLAY.memberLayout ||
    display.workType !== DEFAULT_STANDUP_DISPLAY.workType ||
    display.aiOnly !== DEFAULT_STANDUP_DISPLAY.aiOnly
  );
}

export function useStandupDisplay(userId: string | null) {
  const key = userId === null ? null : standupDisplayKey(userId);
  const [stored, setStored] = useState<{
    readonly key: string | null;
    readonly display: StandupDisplay;
  } | null>(null);

  useEffect(() => {
    setStored({ key, display: key === null ? DEFAULT_STANDUP_DISPLAY : readStandupDisplay(key) });
  }, [key]);

  const loaded = stored !== null && stored.key === key;
  const display = loaded ? stored.display : DEFAULT_STANDUP_DISPLAY;

  const update = useCallback(
    (patch: Partial<StandupDisplay>) => {
      const next = { ...display, ...patch };
      setStored({ key, display: next });
      if (key === null) return;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        return;
      }
    },
    [display, key],
  );

  return { display, loaded, update } as const;
}

export function StandupDisplayOptions({
  display,
  onChange,
}: {
  readonly display: StandupDisplay;
  readonly onChange: (patch: Partial<StandupDisplay>) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Work</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={display.workType}
        onValueChange={(value) => onChange({ workType: workTypeSchema.parse(value) })}
      >
        {workTypeSchema.options.map((workType) => (
          <DropdownMenuRadioItem key={workType} value={workType}>
            {WORK_TYPE_LABELS[workType]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuCheckboxItem
        checked={display.aiOnly}
        title="Tasks with AI agent involvement, including creation, assignment, reviews, comments, reactions, and activity"
        onSelect={(event) => {
          event.preventDefault();
          onChange({ aiOnly: !display.aiOnly });
        }}
      >
        AI only
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Members</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={display.memberLayout}
        onValueChange={(value) => onChange({ memberLayout: memberLayoutSchema.parse(value) })}
      >
        {memberLayoutSchema.options.map((layout) => (
          <DropdownMenuRadioItem
            key={layout}
            value={layout}
            title={MEMBER_LAYOUT_OPTIONS[layout].hint}
            data-testid={`member-layout-${layout}`}
          >
            {MEMBER_LAYOUT_OPTIONS[layout].label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  );
}
