import { getOrganization } from '@orbit/core';
import { can } from '@orbit/shared/policy';
import { GeneralForm } from '@/features/settings/general-form.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function GeneralSettingsPage() {
  const { principal } = await pageContext();
  const organization = await getOrganization(principal.organizationId);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-medium text-lg text-text">General</h2>
      <GeneralForm
        name={organization.name}
        logo={organization.logo}
        allowedEmailDomains={organization.allowedEmailDomains}
        canManage={can(principal, 'org:manage')}
      />
    </section>
  );
}
