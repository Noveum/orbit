export const ONBOARDING_STEPS = ['profile', 'workspace', 'invite', 'theme'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_DONE = 'done' as const;

export const ORG_SIZES = ['just_me', '2_10', '11_50', '51_200', '201_500', '500_plus'] as const;
export type OrgSize = (typeof ORG_SIZES)[number];

export const ONBOARDING_THEMES = ['light', 'dark', 'system'] as const;
export type OnboardingTheme = (typeof ONBOARDING_THEMES)[number];

export interface OnboardingState {
  readonly profileComplete?: boolean;
  readonly workspaceCreate?: boolean;
  readonly workspaceJoin?: boolean;
  readonly workspaceInvite?: boolean;
  readonly themeSet?: boolean;
  readonly theme?: OnboardingTheme;
  readonly orgSize?: OrgSize;
}

export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  'about',
  'account',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'callback',
  'contact',
  'cycles',
  'd',
  'dashboard',
  'docs',
  'help',
  'home',
  'inbox',
  'invite',
  'invites',
  'legal',
  'login',
  'logout',
  'me',
  'my-issues',
  'new',
  'oauth',
  'onboarding',
  'orbit',
  'pricing',
  'privacy',
  'projects',
  'public',
  'settings',
  'signin',
  'signout',
  'signup',
  'static',
  'status',
  'support',
  'team',
  'teams',
  'terms',
  'user',
  'users',
  'views',
  'workspace',
  'workspaces',
  'www',
]);

export function isReservedWorkspaceSlug(slug: string): boolean {
  return RESERVED_WORKSPACE_SLUGS.has(slug.trim().toLowerCase());
}

export function workspaceReady(options: { hasWorkspace: boolean }): boolean {
  return options.hasWorkspace;
}

export function resolveOnboardingStep(
  state: OnboardingState,
  options: { hasWorkspace: boolean },
): OnboardingStep | typeof ONBOARDING_DONE {
  if (state.profileComplete !== true) return 'profile';
  if (!workspaceReady(options)) return 'workspace';
  if (state.workspaceInvite !== true) return 'invite';
  if (state.themeSet !== true) return 'theme';
  return ONBOARDING_DONE;
}
