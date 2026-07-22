import { can } from '@orbit/shared/policy';
import { listMemberViews, listTeamDetails } from '@/features/settings/data.ts';
import { TeamsPanel } from '@/features/settings/teams-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function TeamsSettingsPage() {
  const { principal } = await pageContext();
  const [teams, members] = await Promise.all([
    listTeamDetails(principal),
    listMemberViews(principal),
  ]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Teams</h2>
        <p className="text-muted text-xs">
          Teams own their issues, workflow states, and cycles. Keys prefix every issue identifier.
        </p>
      </div>
      <TeamsPanel teams={teams} members={members} canManage={can(principal, 'team:manage')} />
    </section>
  );
}
