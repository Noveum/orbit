import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CircleDot,
  FileText,
  FolderKanban,
  GitPullRequest,
  Inbox,
  Keyboard,
  LayoutList,
  Moon,
  PanelLeft,
  RefreshCcw,
  Settings,
  Sun,
  Target,
  Users,
} from 'lucide-react';
import type { HotkeySection } from '@/lib/keyboard/index.ts';

export interface ShellTeam {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color?: string | undefined;
  readonly openIssues?: number | undefined;
}

export interface ShellWorkspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface ShellUser {
  readonly name: string;
  readonly email: string;
  readonly image?: string | null | undefined;
}

export interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly binding?: string | undefined;
  readonly count?: number | undefined;
}

export interface NavSection {
  readonly id: string;
  readonly title?: string | undefined;
  readonly links: readonly NavLink[];
}

const TEAM_SECTION_PREFIX = 'team-';

export function buildNavigation(teams: readonly ShellTeam[], inboxCount = 0): NavSection[] {
  return [
    {
      id: 'personal',
      links: [
        { href: '/inbox', label: 'Inbox', icon: Inbox, binding: 'g i', count: inboxCount },
        { href: '/my-issues', label: 'My issues', icon: CircleDot, binding: 'g m' },
        { href: '/pulls', label: 'Pull requests', icon: GitPullRequest, binding: 'g r' },
      ],
    },
    {
      id: 'workspace',
      title: 'Workspace',
      links: [
        { href: '/projects', label: 'Projects', icon: FolderKanban, binding: 'g p' },
        { href: '/cycles', label: 'Cycles', icon: RefreshCcw },
        { href: '/standup', label: 'Standup', icon: Users, binding: 'g s' },
        { href: '/views', label: 'Views', icon: LayoutList, binding: 'g v' },
        { href: '/analytics', label: 'Analytics', icon: BarChart3, binding: 'g a' },
        { href: '/docs', label: 'Docs', icon: FileText, binding: 'g d' },
      ],
    },
    ...teams.map((team) => ({
      id: `${TEAM_SECTION_PREFIX}${team.id}`,
      title: team.name,
      links: [
        {
          href: `/team/${team.key.toLowerCase()}/issues`,
          label: 'Issues',
          icon: CircleDot,
          count: team.openIssues,
        },
        { href: `/team/${team.key.toLowerCase()}/board`, label: 'Board', icon: Target },
        {
          href: `/team/${team.key.toLowerCase()}/cycle/active`,
          label: 'Active cycle',
          icon: RefreshCcw,
        },
      ],
    })),
  ];
}

export interface NavGroup {
  readonly id: string;
  readonly title: string;
  readonly links: readonly NavLink[];
}

export interface NavTeamNode {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly href: string;
  readonly count?: number | undefined;
  readonly children: readonly NavLink[];
}

export interface SidebarNav {
  readonly personal: readonly NavLink[];
  readonly workspace: NavGroup;
  readonly teams: readonly NavTeamNode[];
}

const DEFAULT_TEAM_COLOR = '#5A63C8';

export function buildSidebarNav(teams: readonly ShellTeam[], inboxCount = 0): SidebarNav {
  return {
    personal: [
      { href: '/inbox', label: 'Inbox', icon: Inbox, binding: 'g i', count: inboxCount },
      { href: '/my-issues', label: 'My issues', icon: CircleDot, binding: 'g m' },
      { href: '/pulls', label: 'Pull requests', icon: GitPullRequest, binding: 'g r' },
    ],
    workspace: {
      id: 'workspace',
      title: 'Workspace',
      links: [
        { href: '/projects', label: 'Projects', icon: FolderKanban, binding: 'g p' },
        { href: '/cycles', label: 'Cycles', icon: RefreshCcw },
        { href: '/standup', label: 'Standup', icon: Users, binding: 'g s' },
        { href: '/views', label: 'Views', icon: LayoutList, binding: 'g v' },
        { href: '/analytics', label: 'Analytics', icon: BarChart3, binding: 'g a' },
        { href: '/docs', label: 'Docs', icon: FileText, binding: 'g d' },
      ],
    },
    teams: teams.map((team) => {
      const key = team.key.toLowerCase();
      return {
        id: team.id,
        key: team.key,
        name: team.name,
        color: team.color ?? DEFAULT_TEAM_COLOR,
        href: `/team/${key}/issues`,
        count: team.openIssues,
        children: [
          {
            href: `/team/${key}/issues`,
            label: 'Issues',
            icon: CircleDot,
            count: team.openIssues,
          },
          { href: `/team/${key}/board`, label: 'Board', icon: Target },
          { href: `/team/${key}/cycle/active`, label: 'Active cycle', icon: RefreshCcw },
        ],
      };
    }),
  };
}

export interface AppCommand {
  readonly id: string;
  readonly label: string;
  readonly section: HotkeySection;
  readonly icon: LucideIcon;
  readonly binding?: string | undefined;
  readonly run: () => void;
}

export interface CommandContext {
  readonly sections: readonly NavSection[];
  readonly navigate: (href: string) => void;
  readonly toggleSidebar: () => void;
  readonly toggleTheme: () => void;
  readonly showShortcuts: () => void;
  readonly dark: boolean;
}

function surfaceLabel(section: NavSection, link: NavLink): string {
  if (!section.id.startsWith(TEAM_SECTION_PREFIX) || section.title === undefined) {
    return `Go to ${link.label}`;
  }
  return `Go to ${section.title} ${link.label.toLowerCase()}`;
}

export function buildCommands(context: CommandContext): AppCommand[] {
  const surfaces = context.sections.flatMap((section) =>
    section.links.map((link) => ({
      id: `navigate:${link.href}`,
      label: surfaceLabel(section, link),
      section: 'Navigation' as const,
      icon: link.icon,
      binding: link.binding,
      run: () => context.navigate(link.href),
    })),
  );

  return [
    ...surfaces,
    {
      id: 'navigate:/settings',
      label: 'Go to Settings',
      section: 'Navigation',
      icon: Settings,
      run: () => context.navigate('/settings'),
    },
    {
      id: 'view:theme',
      label: context.dark ? 'Switch to light theme' : 'Switch to dark theme',
      section: 'View',
      icon: context.dark ? Sun : Moon,
      run: context.toggleTheme,
    },
    {
      id: 'view:sidebar',
      label: 'Toggle sidebar',
      section: 'View',
      icon: PanelLeft,
      binding: '[',
      run: context.toggleSidebar,
    },
    {
      id: 'general:shortcuts',
      label: 'Keyboard shortcuts',
      section: 'General',
      icon: Keyboard,
      binding: '?',
      run: context.showShortcuts,
    },
  ];
}
