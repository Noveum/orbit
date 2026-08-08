import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listMemberViews, listTeamDetails } from '@/features/settings/data.ts';
import { TeamSettingsPanel } from '@/features/settings/team-settings-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Team settings' };

export default async function TeamSettingsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { principal } = await pageContext();
  const [teams, members] = await Promise.all([
    listTeamDetails(principal),
    listMemberViews(principal),
  ]);
  const team = teams.find((entry) => entry.key.toLowerCase() === key.toLowerCase());
  if (team === undefined) notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">{team.name}</h1>
        <p className="text-muted text-xs">
          What this team is called, who is on it, and whether it stays in the sidebar.
        </p>
      </header>
      <TeamSettingsPanel team={team} members={members} canManage={can(principal, 'team:manage')} />
    </div>
  );
}
