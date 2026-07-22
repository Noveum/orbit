import type { LucideIcon } from 'lucide-react';
import {
  CircleDot,
  FileText,
  FolderKanban,
  Inbox,
  LayoutList,
  RefreshCcw,
  Target,
} from 'lucide-react';

export interface ShellTeam {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly openIssues?: number | undefined;
}

export interface ShellWorkspace {
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
  readonly shortcut?: readonly string[] | undefined;
  readonly count?: number | undefined;
}

export interface NavSection {
  readonly id: string;
  readonly title?: string | undefined;
  readonly links: readonly NavLink[];
}

export function buildNavigation(teams: readonly ShellTeam[], inboxCount = 0): NavSection[] {
  return [
    {
      id: 'personal',
      links: [
        { href: '/inbox', label: 'Inbox', icon: Inbox, shortcut: ['g', 'i'], count: inboxCount },
        { href: '/my-issues', label: 'My issues', icon: CircleDot, shortcut: ['g', 'm'] },
      ],
    },
    {
      id: 'workspace',
      title: 'Workspace',
      links: [
        { href: '/projects', label: 'Projects', icon: FolderKanban, shortcut: ['g', 'p'] },
        { href: '/views', label: 'Views', icon: LayoutList },
        { href: '/docs', label: 'Docs', icon: FileText },
      ],
    },
    ...teams.map((team) => ({
      id: `team-${team.id}`,
      title: team.name,
      links: [
        {
          href: `/team/${team.key.toLowerCase()}/issues`,
          label: 'Issues',
          icon: CircleDot,
          count: team.openIssues,
        },
        { href: `/team/${team.key.toLowerCase()}/cycles`, label: 'Cycles', icon: RefreshCcw },
        { href: `/team/${team.key.toLowerCase()}/projects`, label: 'Projects', icon: Target },
      ],
    })),
  ];
}
