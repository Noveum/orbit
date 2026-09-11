'use client';

import { useEffect, useRef, useState } from 'react';
import { isEditableTarget } from '@/lib/keyboard/binding.ts';
import { PersonTiles, type PersonTilesProps, UNASSIGNED } from './person-tiles.tsx';

function memberSwitchDirection(event: KeyboardEvent, isMac: boolean): number {
  if (isMac) {
    if (event.key !== 'Tab') return 0;
    return event.shiftKey ? -1 : 1;
  }
  if (event.shiftKey) return 0;
  switch (event.key.toLowerCase()) {
    case 'j':
      return 1;
    case 'k':
      return -1;
    default:
      return 0;
  }
}

export function MemberPicker(props: PersonTilesProps) {
  const [isMac, setIsMac] = useState(false);
  const current = useRef(props.selectedId);
  current.current = props.selectedId;

  useEffect(() => {
    setIsMac(/Mac/i.test(navigator.platform));
  }, []);

  useEffect(() => {
    const showUnassigned =
      props.selectedId === UNASSIGNED ||
      props.counts === null ||
      (props.counts[UNASSIGNED] ?? 0) > 0;
    const choices = [
      null,
      ...props.members.map((member) => member.id),
      ...(showUnassigned ? [UNASSIGNED] : []),
    ];
    function keydown(event: KeyboardEvent) {
      const direction = memberSwitchDirection(event, isMac);
      if (direction === 0 || !event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
        return;
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const index = choices.indexOf(current.current);
      const next = choices[(index + direction + choices.length) % choices.length] ?? null;
      current.current = next;
      props.onSelect(next);
    }
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [isMac, props.members, props.onSelect, props.counts, props.selectedId]);

  return (
    <fieldset
      data-testid="standup-members"
      aria-label="Standup members"
      className="min-w-0 max-w-full"
      title={
        isMac
          ? 'Next member: Option+Tab. Previous member: Option+Shift+Tab'
          : 'Next member: Alt+J. Previous member: Alt+K'
      }
    >
      <PersonTiles {...props} />
    </fieldset>
  );
}
