import { listTeams } from '@orbit/core';
import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findProjectDetail } from '@/features/projects/data.ts';
import { ProjectSettingsForm } from '@/features/projects/project-settings-form.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Project settings' };

export default async function ProjectSettingsPage({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { principal } = await pageContext();
  const detail = await findProjectDetail(principal, slug);
  if (detail === null) notFound();

  const teams = await listTeams(principal);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-medium text-lg text-text">Settings</h2>
      <ProjectSettingsForm
        projectId={detail.summary.id}
        slug={slug}
        name={detail.summary.name}
        summary={detail.summary.summary}
        status={detail.summary.status}
        health={detail.summary.health}
        startDate={detail.startDate}
        targetDate={detail.summary.targetDate}
        teams={teams.map((team) => ({ id: team.id, key: team.key, name: team.name }))}
        selectedTeamIds={detail.teams.map((team) => team.id)}
        canManage={can(principal, 'project:manage')}
      />
    </section>
  );
}
