'use client';

import type { Measure } from '@orbit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { BarChart } from '@/features/charts/bar-chart.tsx';
import { Histogram } from '@/features/charts/histogram.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { BurndownChart } from './burndown-chart.tsx';
import type { CycleBundle, CycleOption } from './data.ts';

interface CyclePanelProps {
  readonly cycles: readonly CycleOption[];
  readonly measure: Measure;
  readonly canManage: boolean;
}

function useInView(): { ref: (node: HTMLElement | null) => void; inView: boolean } {
  const [inView, setInView] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  function ref(node: HTMLElement | null): void {
    observer.current?.disconnect();
    if (node === null || inView) return;
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: '200px' },
    );
    observer.current.observe(node);
  }
  useEffect(() => () => observer.current?.disconnect(), []);
  return { ref, inView };
}

function StatTile({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-surface px-3 py-2">
      <span className="font-semibold text-lg text-text tabular">{value}</span>
      <span className="text-2xs text-faint uppercase">{label}</span>
    </div>
  );
}

export function CyclePanel({ cycles, measure, canManage }: CyclePanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { ref, inView } = useInView();
  const initial = cycles.find((cycle) => cycle.active)?.id ?? cycles[0]?.id ?? '';
  const [cycleId, setCycleId] = useState(initial);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const measureLabel = measure === 'points' ? 'Points' : 'Issues';

  const query = useQuery({
    queryKey: ['analytics-cycle', cycleId, measure],
    queryFn: () =>
      apiRequest<{ bundle: CycleBundle }>(`/api/analytics/cycle/${cycleId}?measure=${measure}`),
    enabled: inView && cycleId.length > 0,
  });

  async function submitCheckpoint(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (label.trim().length === 0) return;
    setPending(true);
    try {
      await apiRequest('/api/analytics/checkpoints', {
        method: 'POST',
        body: { cycleId, label: label.trim() },
      });
      setLabel('');
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['analytics-cycle', cycleId, measure] });
    } catch (error) {
      toast({ title: 'Could not add checkpoint', description: messageOf(error), tone: 'danger' });
    } finally {
      setPending(false);
    }
  }

  const bundle = query.data?.bundle;

  let body: ReactNode = null;
  if (cycles.length === 0) {
    body = (
      <p className="rounded-md border border-border border-dashed py-8 text-center text-faint text-xs">
        No cycles exist yet, so there is nothing to break down.
      </p>
    );
  } else if (query.isError) {
    body = (
      <p role="alert" className="text-danger text-xs">
        {messageOf(query.error)}
      </p>
    );
  } else if (bundle === undefined) {
    body = (
      <div
        className="h-48 animate-pulse rounded-lg border border-border bg-surface-2"
        aria-hidden="true"
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Throughput" value={bundle.flow.throughput} />
          <StatTile label="Added" value={bundle.churn.added} />
          <StatTile label="Removed" value={bundle.churn.removed} />
          <StatTile label="Net churn" value={bundle.churn.added - bundle.churn.removed} />
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <BurndownChart
            points={bundle.burndown.points}
            checkpoints={bundle.checkpoints}
            measureLabel={measureLabel}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-4">
            <Histogram
              title="Cycle time"
              values={bundle.flow.cycleTimeDays}
              p50={bundle.flow.cycleTime.p50}
              p85={bundle.flow.cycleTime.p85}
              unit="d"
            />
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <Histogram
              title="Lead time"
              values={bundle.flow.leadTimeDays}
              p50={bundle.flow.leadTime.p50}
              p85={bundle.flow.leadTime.p85}
              unit="d"
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <BarChart
            title="Velocity across cycles"
            description={`Completed ${measureLabel.toLowerCase()} per cycle.`}
            valueLabel={measureLabel}
            data={bundle.velocity.map((point) => ({
              key: point.cycleId,
              name: point.name,
              value: point.completed,
            }))}
          />
        </div>
      </div>
    );
  }

  const checkpointControl = editing ? (
    <form onSubmit={submitCheckpoint} className="flex items-center gap-1.5">
      <input
        type="text"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Checkpoint label"
        aria-label="Checkpoint label"
        className="h-8 w-36 rounded-md border border-border bg-surface px-2 text-text text-xs"
      />
      <Button type="submit" size="sm" variant="primary" disabled={pending || bundle === undefined}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  ) : (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={bundle === undefined}
      onClick={() => setEditing(true)}
    >
      Add checkpoint
    </Button>
  );

  return (
    <section ref={ref} aria-label="Cycle analytics" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold text-base text-text">Cycle analytics</h2>
          <p className="text-muted text-xs">Burndown, churn, cycle time and velocity per cycle.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="analytics-cycle" className="sr-only">
            Cycle
          </label>
          <select
            id="analytics-cycle"
            value={cycleId}
            onChange={(event) => setCycleId(event.target.value)}
            disabled={cycles.length === 0}
            className="h-8 rounded-md border border-border bg-surface px-2 text-muted text-xs"
          >
            {cycles.length === 0 ? <option value="">No cycles</option> : null}
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.label}
                {cycle.active ? ' (active)' : ''}
              </option>
            ))}
          </select>
          {canManage ? checkpointControl : null}
        </div>
      </header>
      {body}
    </section>
  );
}
