import { completeOnboarding, getOnboardingStatus, pendingInvitesForEmail } from '@orbit/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/features/onboarding/onboarding-flow.tsx';
import type { OnboardingStatusView, PendingInviteView } from '@/features/onboarding/types.ts';
import { requireSession } from '@/lib/auth/session.ts';
import { safeNextPath } from '@/lib/next-path.ts';

export const metadata: Metadata = { title: 'Get started' };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const landingPath = safeNextPath(params['next']) ?? '/my-issues';

  const status = await getOnboardingStatus(session.user.id);
  if (status.completed) redirect(landingPath);
  if (status.step === 'done') {
    await completeOnboarding(session.user.id);
    redirect(landingPath);
  }

  const invites: PendingInviteView[] =
    status.step === 'workspace' ? await pendingInvitesForEmail(status.email) : [];

  const view: OnboardingStatusView = {
    name: status.name,
    handle: status.handle,
    email: status.email,
    image: status.image,
    state: status.state,
    hasWorkspace: status.hasWorkspace,
    completed: status.completed,
    step: status.step,
  };

  return (
    <OnboardingFlow
      initialStep={status.step}
      status={view}
      invites={invites}
      landingPath={landingPath}
    />
  );
}
