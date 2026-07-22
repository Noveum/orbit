import { FolderKanban } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Donut } from '@/features/charts/donut.tsx';
import { listProjectSummaries } from '@/features/projects/data.ts';
import { HealthChip, STATUS_LABELS } from '@/features/projects/health-chip.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Projects' };

function formatDate(value: string | null): string {
  if (value === null) return 'No target';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default async function ProjectsPage() {
  const { principal } = await pageContext();
  const projects = await listProjectSummaries(principal);

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderKanban strokeWidth={1.75} aria-hidden="true" />}
        title="No projects yet"
        description="Projects group issues around an outcome, with milestones and a health signal."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">Projects</h1>
        <p className="text-muted text-xs">
          {projects.length} active {projects.length === 1 ? 'project' : 'projects'}.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] border-collapse text-dense">
          <thead>
            <tr className="border-border border-b text-2xs text-faint uppercase">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Project
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Health
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Lead
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Target
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Issues
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Progress
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} className="border-border border-b last:border-b-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/projects/${project.slug}`}
                    className="flex flex-col gap-0.5 rounded-sm text-text hover:text-accent"
                  >
                    <span className="font-medium">{project.name}</span>
                    <span className="text-faint text-2xs">
                      {STATUS_LABELS[project.status]}
                      {project.summary.length === 0 ? '' : ` · ${project.summary}`}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <HealthChip health={project.health} />
                </td>
                <td className="px-3 py-2">
                  {project.lead === null ? (
                    <span className="text-faint text-xs">Unassigned</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted">
                      <Avatar name={project.lead.name} src={project.lead.image} size="xs" />
                      {project.lead.name}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted tabular">{formatDate(project.targetDate)}</td>
                <td className="px-3 py-2 text-right text-muted tabular">{project.issueCount}</td>
                <td className="px-3 py-2">
                  <Donut completed={project.completedCount} scope={project.issueCount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
