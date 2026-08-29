import { landingMetadata, landingStructuredData } from '@/features/landing/landing-meta.ts';
import { LandingPage } from '@/features/landing/landing-page.tsx';
import { signUpIsOpen } from '@/lib/env.ts';

export const metadata = landingMetadata('/');

export default function HomeLandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants
        dangerouslySetInnerHTML={{ __html: landingStructuredData() }}
      />
      <LandingPage openSignUp={signUpIsOpen()} />
    </>
  );
}
