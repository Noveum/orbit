'use client';

import type { Measure, SavedAnalyticsViewPayload } from '@orbit/core';
import { X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';

interface SavedViewBarProps {
  readonly views: readonly SavedAnalyticsViewPayload[];
  readonly measure: Measure;
  readonly canManage: boolean;
}

export function SavedViewBar({ views, measure, canManage }: SavedViewBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const dashboards = views.filter((view) => view.kind === 'dashboard');

  function apply(view: SavedAnalyticsViewPayload): void {
    const configured = view.config['measure'];
    const query = new URLSearchParams(params.toString());
    query.set('measure', typeof configured === 'string' ? configured : measure);
    router.push(`${pathname}?${query.toString()}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (name.trim().length === 0) return;
    setPending(true);
    try {
      await apiRequest('/api/analytics/views', {
        method: 'POST',
        body: { name: name.trim(), config: { measure } },
      });
      setName('');
      setEditing(false);
      router.refresh();
    } catch (error) {
      toast({ title: 'Could not save that view', description: messageOf(error), tone: 'danger' });
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setPending(true);
    try {
      await apiRequest(`/api/analytics/views/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (error) {
      toast({ title: 'Could not delete that view', description: messageOf(error), tone: 'danger' });
    } finally {
      setPending(false);
    }
  }

  const composer = editing ? (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="View name"
        aria-label="Analytics view name"
        className="h-7 w-32 rounded-md border border-border bg-surface px-2 text-text text-xs"
      />
      <Button type="submit" size="sm" variant="primary" disabled={pending}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  ) : (
    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
      Save view
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {dashboards.map((view) => (
        <span
          key={view.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs"
        >
          <button
            type="button"
            onClick={() => apply(view)}
            className="text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
          >
            {view.name}
          </button>
          {canManage ? (
            <button
              type="button"
              aria-label={`Delete ${view.name}`}
              disabled={pending}
              onClick={() => remove(view.id)}
              className={cn(
                'flex size-4 items-center justify-center rounded-full text-faint',
                'transition-colors duration-[var(--duration-fast)] hover:bg-surface-3 hover:text-danger',
              )}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ))}
      {canManage ? composer : null}
    </div>
  );
}
