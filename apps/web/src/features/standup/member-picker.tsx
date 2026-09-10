'use client';

import { ChevronDown, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { isEditableTarget } from '@/lib/keyboard/binding.ts';
import { PersonTiles, type PersonTilesProps, UNASSIGNED } from './person-tiles.tsx';

export function MemberPicker(props: PersonTilesProps) {
  const [open, setOpen] = useState(false);
  const switching = useRef(false);
  const preserveFocus = useRef(false);
  const current = useRef(props.selectedId);
  current.current = props.selectedId;
  const content = useRef<HTMLDivElement>(null);
  const label =
    props.selectedId === UNASSIGNED
      ? 'Unassigned'
      : (props.members.find((member) => member.id === props.selectedId)?.name ?? 'All Members');

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
    function close() {
      if (!switching.current) return;
      switching.current = false;
      setOpen(false);
    }
    function keydown(event: KeyboardEvent) {
      if (
        event.key !== 'Tab' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing
      )
        return;
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      switching.current = true;
      preserveFocus.current = true;
      const index = choices.indexOf(current.current);
      const next =
        choices[(index + (event.shiftKey ? -1 : 1) + choices.length) % choices.length] ?? null;
      current.current = next;
      props.onSelect(next);
      setOpen(true);
    }
    function keyup(event: KeyboardEvent) {
      if (event.key === 'Alt' || !event.altKey) close();
    }
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', close);
    };
  }, [props.members, props.onSelect, props.counts, props.selectedId]);

  useEffect(() => {
    if (open)
      content.current
        ?.querySelector(`[data-testid="standup-tile-${props.selectedId ?? 'everyone'}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, props.selectedId]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        switching.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          data-testid="standup-members"
          aria-label={`Members: ${label}`}
          title="Switch members with Option+Tab or Option+Shift+Tab"
        >
          <Users className="size-3.5" aria-hidden="true" />
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        align="end"
        aria-label="Members"
        className="max-h-80 overflow-y-auto"
        onOpenAutoFocus={(event) => {
          if (switching.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (preserveFocus.current) event.preventDefault();
          preserveFocus.current = false;
        }}
      >
        <PersonTiles
          {...props}
          onSelect={(id) => {
            props.onSelect(id);
            switching.current = false;
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
