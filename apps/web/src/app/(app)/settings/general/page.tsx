import { getOrganization } from '@orbit/core';
import { can } from '@orbit/shared/policy';
import { GeneralForm } from '@/features/settings/general-form.tsx';
import { WorkspaceDangerZone } from '@/features/settings/workspace-danger-zone.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function GeneralSettingsPage() {
  const { principal, deletionRequestedAt } = await pageContext({ allowDeleting: true });
  const organization = await getOrganization(principal.organizationId);
  const deletionPending = deletionRequestedAt !== null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-medium text-lg text-text">General</h2>
      <GeneralForm
        name={organization.name}
        logo={organization.logo}
        allowedEmailDomains={organization.allowedEmailDomains}
        canManage={!deletionPending && can(principal, 'org:manage')}
      />
      {can(principal, 'org:delete') ? (
        <WorkspaceDangerZone
          organizationName={organization.name}
          deletionRequestedAt={deletionRequestedAt?.toISOString() ?? null}
        />
      ) : null}
    </section>
  );
}
