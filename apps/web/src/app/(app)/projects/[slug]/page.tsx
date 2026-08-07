import { can } from '@orbit/shared/policy';
import { notFound } from 'next/navigation';
import { findProjectDetail } from '@/features/projects/data.ts';
import { MilestoneBoard } from '@/features/projects/milestone-board.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import type { Milestone } from '@/lib/query/schemas.ts';

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export default async function ProjectOverviewPage({ params }: PageProps) {
  const { slug } = await params;
  const { principal } = await pageContext();
  const detail = await findProjectDetail(principal, slug);
  if (detail === null) notFound();

  const milestones: Milestone[] = detail.milestones.map((milestone) => ({
    id: milestone.id,
    projectId: milestone.projectId,
    name: milestone.name,
    description: milestone.description,
    targetDate: milestone.targetDate,
    sortOrder: milestone.sortOrder,
    scope: milestone.scope,
    completed: milestone.completed,
  }));

  return (
    <>
      {detail.description.length === 0 ? null : (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-dense text-text">Description</h2>
          <p className="whitespace-pre-wrap text-muted text-sm">{detail.description}</p>
        </section>
      )}

      <MilestoneBoard
        projectId={detail.summary.id}
        milestones={milestones}
        canManage={can(principal, 'milestone:manage')}
      />
    </>
  );
}
