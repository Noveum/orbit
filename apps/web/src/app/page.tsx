import { redirect } from 'next/navigation';
import { landingMetadata, landingStructuredData } from '@/features/landing/landing-meta.ts';
import { LandingPage } from '@/features/landing/landing-page.tsx';
import { getSession } from '@/lib/auth/session.ts';

export const metadata = landingMetadata('/');

export default async function HomePage() {
  const session = await getSession();
  if (session !== null) redirect('/my-issues');

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants
        dangerouslySetInnerHTML={{ __html: landingStructuredData() }}
      />
      <LandingPage />
    </>
  );
}
