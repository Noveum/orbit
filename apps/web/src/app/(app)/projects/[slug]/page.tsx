import { notFound } from 'next/navigation';
import { ProgressBar } from '@/features/charts/donut.tsx';
import { findProjectDetail } from '@/features/projects/data.ts';
import { pageContext } from '@/lib/api/handler.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

function formatDate(value: string | null): string {
  if (value === null) return 'Not set';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function ProjectOverviewPage({ params }: PageProps) {
  const { slug } = await params;
  const { principal } = await pageContext();
  const detail = await findProjectDetail(principal, slug);
  if (detail === null) notFound();

  return (
    <>
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
                className={cn('flex flex-col gap-2 rounded-lg border border-border p-3', cardHover)}
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
    </>
  );
}
