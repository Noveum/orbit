import Link from 'next/link';
import type { DeploymentGuide as Guide } from './deployment-guides.ts';
import { SetupCopyValue } from './setup-copy-value.tsx';

export function DeploymentGuide({ guide }: { readonly guide: Guide }) {
  return (
    <details className="mt-2 rounded-lg border border-border p-3">
      <summary className="cursor-pointer font-medium text-dense text-text">{guide.title}</summary>
      <div className="mt-4 flex flex-col gap-4">
        <ol className="list-decimal space-y-3 pl-5 text-muted text-xs">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-3 text-accent text-xs underline">
          {guide.links.map((link) =>
            link.href.startsWith('/') ? (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ) : (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ),
          )}
        </div>
        {guide.values.map((value) => (
          <SetupCopyValue key={value.label} {...value} />
        ))}
        <h4 className="font-medium text-xs text-text">Verify it works</h4>
        <p className="text-muted text-xs">
          These are manual checks. Orbit has not run them for you.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-muted text-xs">
          {guide.verification.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}
