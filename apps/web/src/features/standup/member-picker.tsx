'use client';

import { ChevronDown, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { isEditableTarget } from '@/lib/keyboard/binding.ts';
import { PersonTiles, type PersonTilesProps, UNASSIGNED } from './person-tiles.tsx';
import type { MemberLayout } from './standup-display.tsx';
import { useRowFits } from './use-row-fits.ts';

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

export interface MemberPickerProps extends Omit<PersonTilesProps, 'arrangement'> {
  readonly layout: MemberLayout;
}

export function MemberPicker({ layout, ...props }: MemberPickerProps) {
  const measured = useRowFits(layout === 'auto');
  const dropdown = layout === 'dropdown' || (layout === 'auto' && !measured.fits);
  const [open, setOpen] = useState(false);
  const switching = useRef(false);
  const preserveFocus = useRef(false);
  const content = useRef<HTMLDivElement>(null);
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
    function close() {
      if (!switching.current) return;
      switching.current = false;
      setOpen(false);
    }
    function keyup(event: KeyboardEvent) {
      if (event.key === 'Alt' || !event.altKey) close();
    }
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
      if (dropdown) {
        switching.current = true;
        preserveFocus.current = true;
        setOpen(true);
      }
    }
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', close);
    };
  }, [dropdown, isMac, props.members, props.onSelect, props.counts, props.selectedId]);

  useEffect(() => {
    if (open)
      content.current
        ?.querySelector(`[data-testid="standup-tile-${props.selectedId ?? 'everyone'}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, props.selectedId]);

  const shortcut = isMac
    ? 'Next member: Option+Tab. Previous member: Option+Shift+Tab'
    : 'Next member: Alt+J. Previous member: Alt+K';
  const selected = props.members.find((member) => member.id === props.selectedId);
  const label =
    selected?.name.trim() ?? (props.selectedId === UNASSIGNED ? 'Unassigned' : 'All Members');

  const menu = (
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
          aria-label={`Members: ${selected?.name ?? label}`}
          title={shortcut}
        >
          <Users className="size-3.5" aria-hidden="true" />
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        align="start"
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
          arrangement="stack"
          onSelect={(id) => {
            props.onSelect(id);
            switching.current = false;
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );

  if (layout === 'dropdown') return menu;

  if (layout === 'list')
    return (
      <fieldset
        data-testid="standup-members"
        aria-label="Standup members"
        className="w-full min-w-0 sm:w-auto sm:flex-1"
        title={shortcut}
      >
        <PersonTiles {...props} arrangement="wrap" />
      </fieldset>
    );

  return (
    <div ref={measured.container} className="relative flex min-w-0 flex-1 items-center">
      <div
        aria-hidden={!measured.fits}
        inert={!measured.fits}
        className={
          measured.fits
            ? 'contents'
            : 'pointer-events-none invisible absolute inset-0 overflow-hidden'
        }
      >
        <fieldset
          ref={measured.row}
          data-testid={measured.fits ? 'standup-members' : undefined}
          aria-label="Standup members"
          className="w-max shrink-0"
          title={shortcut}
        >
          <PersonTiles {...props} arrangement="row" />
        </fieldset>
      </div>
      {measured.fits ? null : menu}
    </div>
  );
}
