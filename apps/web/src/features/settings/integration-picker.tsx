'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import type { IntegrationTeam } from './integrations-data.ts';

export interface PickerItem {
  readonly id: string;
  readonly label: string;
  readonly linked: boolean;
}

export interface IntegrationPickerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly searchPlaceholder: string;
  readonly items: readonly PickerItem[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadMore: () => void;
  readonly teams: readonly IntegrationTeam[];
  readonly allowWorkspace?: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (item: PickerItem, teamId: string | null) => Promise<void>;
}

export function IntegrationPicker({
  open,
  onOpenChange,
  title,
  description,
  searchPlaceholder,
  items,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  teams,
  allowWorkspace = false,
  submitLabel,
  onSubmit,
}: IntegrationPickerProps) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState(allowWorkspace ? '' : (teams[0]?.id ?? ''));
  const [submitting, setSubmitting] = useState(false);
  const sentinelRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (open) return;
    setSearch('');
    setSelectedId(null);
    setSubmitting(false);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return items;
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  }, [items, search]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (node === null || !open || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage) {
        onLoadMore();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, hasNextPage, isFetchingNextPage, onLoadMore]);

  const selected = filtered.find((item) => item.id === selectedId) ?? null;

  const renderBody = () => {
    if (isError) {
      return (
        <li className="px-3 py-2.5 text-danger text-xs">
          Could not load the list. Try again shortly.
        </li>
      );
    }
    if (isLoading) return <li className="px-3 py-2.5 text-faint text-xs">Loading…</li>;
    if (filtered.length === 0) {
      return <li className="px-3 py-2.5 text-faint text-xs">Nothing matches your search.</li>;
    }
    return filtered.map((item) => (
      <li key={item.id}>
        <button
          type="button"
          disabled={item.linked}
          aria-pressed={selectedId === item.id}
          onClick={() => setSelectedId(item.id)}
          className={`flex w-full items-center justify-between gap-3 border-border border-b px-3 py-2 text-left last:border-b-0 disabled:cursor-not-allowed ${
            selectedId === item.id ? 'bg-surface-2' : ''
          } ${item.linked ? 'text-faint' : 'text-text hover:bg-surface-2'}`}
        >
          <span className="truncate text-dense">{item.label}</span>
          {item.linked ? <span className="text-2xs text-faint">Linked</span> : null}
        </button>
      </li>
    ));
  };

  const submit = async () => {
    if (selected === null) return;
    setSubmitting(true);
    try {
      await onSubmit(selected, allowWorkspace && teamId === '' ? null : teamId);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="integration-picker">
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">{title}</DialogTitle>
          <DialogDescription className="text-muted text-xs">{description}</DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={search}
          placeholder={searchPlaceholder}
          aria-label="Search"
          onChange={(event) => setSearch(event.target.value)}
        />

        <ul
          className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-border"
          data-testid="integration-picker-list"
        >
          {renderBody()}
          <li ref={sentinelRef} aria-hidden="true" />
          {hasNextPage ? (
            <li className="px-3 py-2">
              <Button variant="ghost" size="sm" disabled={isFetchingNextPage} onClick={onLoadMore}>
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </li>
          ) : null}
        </ul>

        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-dense text-muted">
            {selected === null ? 'Select an item above' : selected.label}
          </span>
          <select
            aria-label="Team"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-dense text-text"
          >
            {allowWorkspace ? <option value="">Workspace-wide</option> : null}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            disabled={selected === null || submitting || (!allowWorkspace && teamId === '')}
            onClick={submit}
          >
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
