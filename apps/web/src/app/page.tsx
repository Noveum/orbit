import { redirect } from 'next/navigation';
import { AuthErrorNotice } from '@/components/auth/auth-error-notice.tsx';
import { landingMetadata, landingStructuredData } from '@/features/landing/landing-meta.ts';
import { LandingPage } from '@/features/landing/landing-page.tsx';
import { authErrorCode } from '@/lib/auth/oauth-error.ts';
import { getSession } from '@/lib/auth/session.ts';

export const metadata = landingMetadata('/');

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session !== null) redirect('/my-issues');

  const errorCode = authErrorCode((await searchParams)['error']);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants
        dangerouslySetInnerHTML={{ __html: landingStructuredData() }}
      />
      <LandingPage />
      {errorCode === undefined ? null : <AuthErrorNotice code={errorCode} />}
    </>
  );
}
