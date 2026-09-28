'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu.tsx';

const memberLayoutSchema = z.enum(['cards', 'dropdown']);
export type MemberLayout = z.infer<typeof memberLayoutSchema>;

export function useMemberLayout(userId: string | null) {
  const key = userId === null ? null : `orbit.standup.member-layout.${userId}`;
  const [layout, setLayout] = useState<MemberLayout>('cards');

  useEffect(() => {
    if (key === null) {
      setLayout('cards');
      return;
    }
    try {
      const stored = memberLayoutSchema.safeParse(window.localStorage.getItem(key));
      setLayout(stored.success ? stored.data : 'cards');
    } catch {
      setLayout('cards');
    }
  }, [key]);

  const update = useCallback(
    (next: MemberLayout) => {
      setLayout(next);
      if (key === null) return;
      try {
        window.localStorage.setItem(key, next);
      } catch {
        return;
      }
    },
    [key],
  );

  return [layout, update] as const;
}

export function MemberLayoutOptions({
  layout,
  onChange,
}: {
  readonly layout: MemberLayout;
  readonly onChange: (layout: MemberLayout) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Members</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={layout}
        onValueChange={(value) => onChange(memberLayoutSchema.parse(value))}
      >
        <DropdownMenuRadioItem value="cards">Cards</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dropdown">Dropdown</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  );
}
