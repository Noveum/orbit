import type { Breadcrumb } from '@/components/layout/top-bar.tsx';

const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NAVIGABLE_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/inbox$/,
  /^\/my-issues$/,
  /^\/pulls$/,
  /^\/projects$/,
  /^\/projects\/[^/]+$/,
  /^\/cycles$/,
  /^\/views$/,
  /^\/docs$/,
  /^\/docs\/new$/,
  /^\/docs\/[^/]+$/,
  /^\/analytics$/,
  /^\/issue\/[^/]+$/,
  /^\/settings$/,
  /^\/settings\/general$/,
  /^\/settings\/members$/,
  /^\/settings\/teams$/,
  /^\/settings\/integrations$/,
  /^\/settings\/notifications$/,
  /^\/settings\/account$/,
  /^\/settings\/account\/connections$/,
  /^\/settings\/account\/passkeys$/,
  /^\/settings\/account\/password$/,
  /^\/settings\/account\/sessions$/,
  /^\/team\/[^/]+\/issues$/,
  /^\/team\/[^/]+\/board$/,
  /^\/team\/[^/]+\/cycle\/active$/,
  /^\/workspaces\/new$/,
];

function isNavigable(path: string): boolean {
  return NAVIGABLE_ROUTES.some((route) => route.test(path));
}

function titleize(segment: string): string {
  const words = segment.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function breadcrumbsFor(pathname: string, workspaceName: string): Breadcrumb[] {
  const trail: { readonly label: string; readonly href: string }[] = [
    { label: workspaceName, href: '/' },
  ];
  let accumulated = '';
  for (const segment of pathname.split('/')) {
    if (segment.length === 0) continue;
    accumulated += `/${segment}`;
    if (OPAQUE_ID.test(segment)) continue;
    trail.push({ label: titleize(segment), href: accumulated });
  }
  return trail.map((crumb, index) => {
    const last = index === trail.length - 1;
    if (last || !isNavigable(crumb.href)) return { label: crumb.label };
    return { label: crumb.label, href: crumb.href };
  });
}
