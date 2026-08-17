import { describe, expect, it } from 'bun:test';
import type { CommandContext, NavLink, ShellTeam } from '@/lib/navigation.ts';
import { buildCommands, buildNavigation, buildSidebarNav } from '@/lib/navigation.ts';

const TEAMS: readonly ShellTeam[] = [
  { id: 'team_1', key: 'ENG', name: 'Engineering', openIssues: 4 },
];

function shape(links: readonly NavLink[]): { href: string; binding?: string }[] {
  return links.map((link) => ({
    href: link.href,
    ...(link.binding === undefined ? {} : { binding: link.binding }),
  }));
}

function sectionLinks(id: string): readonly NavLink[] {
  const section = buildNavigation(TEAMS, 2).find((entry) => entry.id === id);
  if (section === undefined) throw new Error(`no ${id} section`);
  return section.links;
}

describe('the command palette and the sidebar read the same navigation', () => {
  it('offers the same personal links, in the same order, with the same bindings', () => {
    expect(shape(sectionLinks('personal'))).toEqual(shape(buildSidebarNav(TEAMS, 2).personal));
  });

  it('offers the same workspace links, in the same order, with the same bindings', () => {
    expect(shape(sectionLinks('workspace'))).toEqual(
      shape(buildSidebarNav(TEAMS, 2).workspace.links),
    );
  });

  it('offers the same links under a team', () => {
    const fromSections = sectionLinks('team-team_1');
    const fromSidebar = buildSidebarNav(TEAMS, 2).teams[0]?.children ?? [];

    expect(shape(fromSections)).toEqual(shape(fromSidebar));
  });
});

describe('navigation bindings', () => {
  it('gives every binding to exactly one destination', () => {
    const bound = [
      ...buildSidebarNav(TEAMS, 2).personal,
      ...buildSidebarNav(TEAMS, 2).workspace.links,
    ].flatMap((link) => (link.binding === undefined ? [] : [link.binding]));

    expect(new Set(bound).size).toBe(bound.length);
  });

  it('carries the inbox count through to both surfaces', () => {
    const fromSections = sectionLinks('personal').find((link) => link.href === '/inbox');
    const fromSidebar = buildSidebarNav(TEAMS, 7).personal.find((link) => link.href === '/inbox');

    expect(buildSidebarNav(TEAMS, 7).personal[0]?.count).toBe(7);
    expect(fromSections?.count).toBe(2);
    expect(fromSidebar?.count).toBe(7);
  });
});

describe('global commands', () => {
  it('registers the theme toggle with the shift+t binding', () => {
    const context: CommandContext = {
      sections: [],
      navigate: () => undefined,
      toggleSidebar: () => undefined,
      toggleTheme: () => undefined,
      showShortcuts: () => undefined,
      dark: false,
    };
    const commands = buildCommands(context);
    const themeCommand = commands.find((cmd) => cmd.id === 'view:theme');
    expect(themeCommand).toBeDefined();
    expect(themeCommand?.binding).toBe('shift+t');
  });
});
