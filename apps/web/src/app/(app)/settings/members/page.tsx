import { can } from '@orbit/shared/policy';
import {
  listMemberViews,
  listPendingInviteViews,
  listTeamBadges,
} from '@/features/settings/data.ts';
import { InvitePanel } from '@/features/settings/invite-panel.tsx';
import { MembersTable } from '@/features/settings/members-table.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function MembersSettingsPage() {
  const { principal } = await pageContext();
  const canInvite = can(principal, 'member:invite');
  const [members, teams, invites] = await Promise.all([
    listMemberViews(principal),
    listTeamBadges(principal),
    canInvite ? listPendingInviteViews(principal) : Promise.resolve([]),
  ]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Members</h2>
        <p className="text-muted text-xs">
          {members.length} {members.length === 1 ? 'person' : 'people'} in this workspace.
        </p>
      </div>
      <MembersTable members={members} canManage={can(principal, 'member:manage')} />
      <InvitePanel teams={teams} invites={invites} canInvite={canInvite} />
    </section>
  );
}
