import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar.tsx';
import { findProjectDetail } from '@/features/projects/data.ts';
import { HealthChip } from '@/features/projects/health-chip.tsx';
import { UpdateComposer } from '@/features/projects/update-composer.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';

export const metadata: Metadata = { title: 'Activity' };

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

export default async function ProjectActivityPage({ params }: PageProps) {
  const { slug } = await params;
  const { principal } = await pageContext();
  const detail = await findProjectDetail(principal, slug);
  if (detail === null) notFound();
  const { summary } = detail;

  return (
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
              className={cn('flex flex-col gap-2 rounded-lg border border-border p-3', cardHover)}
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
  );
}
