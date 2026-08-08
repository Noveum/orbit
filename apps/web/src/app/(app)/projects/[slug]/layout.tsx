import { listMembers, listTeams } from '@orbit/core';
import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Donut } from '@/features/charts/donut.tsx';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { findProjectDetail } from '@/features/projects/data.ts';
import { HealthChip, STATUS_LABELS } from '@/features/projects/health-chip.tsx';
import { ProjectFields } from '@/features/projects/project-fields.tsx';
import { ProjectTabs } from '@/features/projects/project-tabs.tsx';
import { pageContext } from '@/lib/api/handler.ts';

interface LayoutProps {
  readonly params: Promise<{ slug: string }>;
  readonly children: ReactNode;
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function ProjectLayout({ params, children }: LayoutProps) {
  const { slug } = await params;
  const { principal } = await pageContext();
  const detail = await findProjectDetail(principal, slug);
  if (detail === null) notFound();

  const [teams, members] = await Promise.all([listTeams(principal), listMembers(principal)]);

  const { summary, progress, series } = detail;
  const chartMax = Math.max(1, ...series.map((point) => point.scope));

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-text text-xl">{summary.name}</h1>
          <HealthChip health={summary.health} />
          <Badge tone="outline">{STATUS_LABELS[summary.status]}</Badge>
        </div>
        {summary.summary.length === 0 ? null : (
          <p className="max-w-2xl text-muted text-sm">{summary.summary}</p>
        )}
        <ProjectFields
          projectId={summary.id}
          lead={summary.lead}
          startDate={detail.startDate}
          targetDate={summary.targetDate}
          status={summary.status}
          teamIds={detail.teams.map((team) => team.id)}
          members={members.map((entry) => ({
            id: entry.user.id,
            name: entry.user.name,
            image: entry.user.image,
          }))}
          teams={teams.map((team) => ({ id: team.id, key: team.key, name: team.name }))}
          canManage={can(principal, 'project:manage')}
          progress={<Donut completed={progress.completed} scope={progress.scope} />}
        />
        <ProjectTabs slug={slug} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">{children}</div>

        <aside className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="flex flex-col">
              <span className="font-medium text-lg text-text tabular">{progress.scope}</span>
              <span className="text-2xs text-faint uppercase">Scope</span>
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-lg text-text tabular">{progress.started}</span>
              <span className="text-2xs text-faint uppercase">Started</span>
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-lg text-text tabular">{progress.completed}</span>
              <span className="text-2xs text-faint uppercase">Done</span>
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-faint text-lg tabular">{progress.canceled}</span>
              <span className="text-2xs text-faint uppercase">Cancelled</span>
            </div>
          </div>
          {series.length === 0 ? (
            <p className="text-faint text-xs">No issues yet, so there is nothing to plot.</p>
          ) : (
            <LineChart
              title="Scope vs completed"
              description={`Scope reached ${summary.issueCount} issues with ${summary.completedCount} completed.`}
              max={chartMax}
              labels={series.map((point) => point.date)}
              series={[
                {
                  id: 'scope',
                  label: 'Scope',
                  tone: 'faint',
                  values: series.map((point) => point.scope),
                },
                {
                  id: 'completed',
                  label: 'Completed',
                  tone: 'accent',
                  filled: true,
                  values: series.map((point) => point.completed),
                },
              ]}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
