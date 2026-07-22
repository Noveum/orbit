import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Donut, ProgressBar } from '@/features/charts/donut.tsx';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { getProjectDetail } from '@/features/projects/data.ts';
import { HealthChip, STATUS_LABELS } from '@/features/projects/health-chip.tsx';
import { UpdateComposer } from '@/features/projects/update-composer.tsx';
import { pageContext } from '@/lib/api/handler.ts';

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

function formatDate(value: string | null): string {
  if (value === null) return 'Not set';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const { principal } = await pageContext();
  const detail = await getProjectDetail(principal, slug).catch(() => null);
  if (detail === null) notFound();

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
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
          <div className="flex items-center gap-2">
            <dt className="text-faint">Lead</dt>
            <dd className="flex items-center gap-1.5 text-muted">
              {summary.lead === null ? (
                'Unassigned'
              ) : (
                <>
                  <Avatar name={summary.lead.name} src={summary.lead.image} size="xs" />
                  {summary.lead.name}
                </>
              )}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-faint">Start</dt>
            <dd className="text-muted tabular">{formatDate(detail.startDate)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-faint">Target</dt>
            <dd className="text-muted tabular">{formatDate(summary.targetDate)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-faint">Teams</dt>
            <dd className="flex gap-1">
              {detail.teams.length === 0 ? (
                <span className="text-muted">None</span>
              ) : (
                detail.teams.map((team) => (
                  <Badge key={team.id} tone="outline">
                    {team.key}
                  </Badge>
                ))
              )}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-faint">Progress</dt>
            <dd>
              <Donut completed={progress.completed} scope={progress.scope} />
            </dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          {detail.description.length === 0 ? null : (
            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-dense text-text">Description</h2>
              <p className="whitespace-pre-wrap text-muted text-sm">{detail.description}</p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="font-medium text-dense text-text">Milestones</h2>
            {detail.milestones.length === 0 ? (
              <p className="text-faint text-xs">No milestones yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {detail.milestones.map((milestone) => (
                  <li
                    key={milestone.id}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-dense text-text">{milestone.name}</span>
                      <span className="text-2xs text-faint tabular">
                        {milestone.completed}/{milestone.scope} · {formatDate(milestone.targetDate)}
                      </span>
                    </div>
                    {milestone.description.length === 0 ? null : (
                      <p className="text-muted text-xs">{milestone.description}</p>
                    )}
                    <ProgressBar
                      completed={milestone.completed}
                      scope={milestone.scope}
                      label={`${milestone.name} completion`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-medium text-dense text-text">Updates</h2>
            <UpdateComposer
              projectId={summary.id}
              currentHealth={summary.health}
              canPost={can(principal, 'project:manage')}
            />
            {detail.updates.length === 0 ? (
              <p className="text-faint text-xs">No updates posted yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {detail.updates.map((update) => (
                  <li
                    key={update.id}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {update.author === null ? null : (
                        <>
                          <Avatar name={update.author.name} src={update.author.image} size="xs" />
                          <span className="text-dense text-text">{update.author.name}</span>
                        </>
                      )}
                      <HealthChip health={update.health} />
                      <time className="text-2xs text-faint tabular" dateTime={update.createdAt}>
                        {formatDate(update.createdAt)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap text-muted text-xs">{update.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
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
