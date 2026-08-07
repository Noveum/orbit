import { can } from '@orbit/shared/policy';
import { listLabelViews, listTeamBadges } from '@/features/settings/data.ts';
import { LabelsPanel } from '@/features/settings/labels-panel.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function LabelsSettingsPage() {
  const { principal } = await pageContext();
  const [labels, teams] = await Promise.all([listLabelViews(principal), listTeamBadges(principal)]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Labels</h2>
        <p className="text-muted text-xs">
          Labels tag issues across the workspace. Keep one on a single team when only that team
          should see it and use it.
        </p>
      </div>
      <LabelsPanel labels={labels} teams={teams} canManage={can(principal, 'label:manage')} />
    </section>
  );
}
