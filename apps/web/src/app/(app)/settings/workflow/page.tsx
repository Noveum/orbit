import { can } from '@orbit/shared/policy';
import { listTeamBadges, listWorkflowStateViews } from '@/features/settings/data.ts';
import { WorkflowPanel } from '@/features/settings/workflow-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function WorkflowSettingsPage() {
  const { principal } = await pageContext();
  const teams = await listTeamBadges(principal);
  const states = await listWorkflowStateViews(
    principal,
    teams.map((team) => team.id),
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Workflow</h2>
        <p className="text-muted text-xs">
          Each team owns its board columns, in order. The category behind a status is what the rest
          of Orbit reads to know whether an issue has started, finished, or been dropped.
        </p>
      </div>
      <WorkflowPanel teams={teams} states={states} canManage={can(principal, 'workflow:manage')} />
    </section>
  );
}
