import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GithubPanel } from '../../../src/features/settings/github-panel.tsx';
import type {
  GithubRepositoryEntry,
  GithubSettingsView,
} from '../../../src/features/settings/github-view.ts';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

function repositoryEntry(overrides: Partial<GithubRepositoryEntry>): GithubRepositoryEntry {
  return {
    id: 'row-1',
    repositoryId: '884762793',
    fullName: 'Noveum/ai-gateway',
    name: 'ai-gateway',
    ownerLogin: 'Noveum',
    private: false,
    archived: false,
    defaultBranch: 'main',
    htmlUrl: 'https://github.com/Noveum/ai-gateway',
    installationId: '151887625',
    accountLogin: 'Noveum',
    links: [],
    ...overrides,
  };
}

const SETTINGS: GithubSettingsView = {
  connected: true,
  connectEnabled: true,
  discoveryEnabled: true,
  installations: [
    {
      installationId: '151887625',
      accountLogin: 'Noveum',
      accountType: 'Organization',
      repositorySelection: 'all',
      status: 'active',
      repositoryCount: 2,
      manageUrl: 'https://github.com/organizations/Noveum/settings/installations/151887625',
    },
    {
      installationId: '151889033',
      accountLogin: 'imshashank',
      accountType: 'User',
      repositorySelection: 'selected',
      status: 'active',
      repositoryCount: 1,
      manageUrl: 'https://github.com/settings/installations/151889033',
    },
  ],
  repositories: [
    repositoryEntry({}),
    repositoryEntry({
      id: 'row-2',
      repositoryId: '900712888',
      fullName: 'Noveum/magic-experiments',
      name: 'magic-experiments',
      private: true,
    }),
    repositoryEntry({
      id: 'row-3',
      repositoryId: '618961824',
      fullName: 'imshashank/magicapi-next-dash',
      name: 'magicapi-next-dash',
      ownerLogin: 'imshashank',
      accountLogin: 'imshashank',
      installationId: '151889033',
      private: true,
    }),
  ],
  projects: [
    { id: 'project-apollo', name: 'Apollo' },
    { id: 'project-gemini', name: 'Gemini' },
  ],
};

const DISCONNECTED: GithubSettingsView = {
  ...SETTINGS,
  connected: false,
  installations: [],
  repositories: [],
};

const realFetch = globalThis.fetch;
let requests: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  refresh.mockClear();
  requests = [];
  globalThis.fetch = mock((url: string, init?: { method?: string; body?: string }) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderPanel(settings: GithubSettingsView, canManage = true) {
  return render(<GithubPanel settings={settings} canManage={canManage} onError={mock()} />);
}

describe('GithubPanel, connecting', () => {
  it('offers a single connect link when nothing is connected', () => {
    renderPanel(DISCONNECTED);
    expect(screen.getByRole('link', { name: 'Connect GitHub' })).toHaveAttribute(
      'href',
      '/api/integrations/github/start',
    );
  });

  it('keeps offering to connect another organisation once one is connected', () => {
    renderPanel(SETTINGS);
    expect(screen.getByRole('link', { name: 'Connect another organisation' })).toHaveAttribute(
      'href',
      '/api/integrations/github/start',
    );
  });

  it('explains that setup is pending rather than offering a link that cannot work', () => {
    renderPanel({ ...DISCONNECTED, connectEnabled: false });
    expect(screen.queryByRole('link', { name: 'Connect GitHub' })).toBeNull();
    expect(screen.getByText(/finish configuring the GitHub App/)).toBeInTheDocument();
  });
});

describe('GithubPanel, installations', () => {
  it('lists every installation with its account and what it can see', () => {
    renderPanel(SETTINGS);
    expect(screen.getByText('Organization · All repositories')).toBeInTheDocument();
    expect(screen.getByText('User · 1 selected')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Remove the .+ installation$/ })).toHaveLength(2);
  });

  it('links each installation to the right place on GitHub to change repositories', () => {
    renderPanel(SETTINGS);
    const links = screen.getAllByRole('link', { name: 'Manage on GitHub' });
    expect(links[0]).toHaveAttribute(
      'href',
      'https://github.com/organizations/Noveum/settings/installations/151887625',
    );
    expect(links[1]).toHaveAttribute('href', 'https://github.com/settings/installations/151889033');
  });

  it('flags a suspended installation so the empty repository list makes sense', () => {
    renderPanel({
      ...SETTINGS,
      installations: SETTINGS.installations
        .slice(0, 1)
        .map((installation) => ({ ...installation, status: 'suspended' })),
    });
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('removes one installation without touching the other', async () => {
    const user = userEvent.setup();
    renderPanel(SETTINGS);

    await user.click(screen.getByRole('button', { name: 'Remove the imshashank installation' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toBe(
      '/api/integrations/github/installations?installationId=151889033',
    );
  });
});

describe('GithubPanel, repositories', () => {
  it('groups repositories by the organisation they came from', () => {
    renderPanel(SETTINGS);
    const headings = screen.getAllByRole('heading', { level: 4 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Noveum', 'imshashank']);
  });

  it('marks private repositories and leaves public ones unmarked', () => {
    renderPanel(SETTINGS);
    expect(screen.getAllByText('Private')).toHaveLength(2);
  });

  it('filters the list as you search', async () => {
    const user = userEvent.setup();
    renderPanel(SETTINGS);

    await user.type(screen.getByLabelText('Search repositories'), 'magic-experiments');

    expect(screen.getByText('Noveum/magic-experiments')).toBeInTheDocument();
    expect(screen.queryByText('Noveum/ai-gateway')).toBeNull();
  });

  it('associates a repository with a project in one click', async () => {
    const user = userEvent.setup();
    renderPanel(SETTINGS);

    await user.selectOptions(
      screen.getByLabelText('Associate Noveum/ai-gateway with'),
      'project-apollo',
    );
    const rows = screen.getAllByRole('listitem');
    const row = rows.find((item) => within(item).queryByText('Noveum/ai-gateway') !== null);
    await user.click(within(row!).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('/api/integrations/github');
    expect(requests[0]?.body).toEqual({
      repositoryId: '884762793',
      projectId: 'project-apollo',
    });
  });

  it('associates a repository with the workspace when no project is chosen', async () => {
    const user = userEvent.setup();
    renderPanel(SETTINGS);

    const rows = screen.getAllByRole('listitem');
    const row = rows.find((item) => within(item).queryByText('Noveum/ai-gateway') !== null);
    await user.click(within(row!).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.body).toEqual({ repositoryId: '884762793', projectId: null });
  });

  it('shows every association a repository already has', () => {
    renderPanel({
      ...SETTINGS,
      repositories: [
        repositoryEntry({
          links: [
            { id: 'link-1', projectId: null, projectName: null },
            { id: 'link-2', projectId: 'project-apollo', projectName: 'Apollo' },
          ],
        }),
      ],
    });

    expect(
      screen.getByRole('button', {
        name: 'Remove the workspace association from Noveum/ai-gateway',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Apollo from Noveum/ai-gateway' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Not associated yet')).toBeNull();
  });

  it('removes one association with a single click', async () => {
    const user = userEvent.setup();
    renderPanel({
      ...SETTINGS,
      repositories: [
        repositoryEntry({
          links: [{ id: 'link-2', projectId: 'project-apollo', projectName: 'Apollo' }],
        }),
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Remove Apollo from Noveum/ai-gateway' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toBe(
      '/api/integrations/github?repositoryId=884762793&projectId=project-apollo',
    );
  });

  it('removes a workspace association without naming a project', async () => {
    const user = userEvent.setup();
    renderPanel({
      ...SETTINGS,
      repositories: [
        repositoryEntry({ links: [{ id: 'link-1', projectId: null, projectName: null }] }),
      ],
    });

    await user.click(
      screen.getByRole('button', {
        name: 'Remove the workspace association from Noveum/ai-gateway',
      }),
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.url).toBe('/api/integrations/github?repositoryId=884762793');
  });

  it('will not add the same association twice', () => {
    renderPanel({
      ...SETTINGS,
      repositories: [
        repositoryEntry({ links: [{ id: 'link-1', projectId: null, projectName: null }] }),
      ],
    });

    expect(screen.getByRole('button', { name: 'Added' })).toBeDisabled();
  });

  it('refreshes the catalogue from GitHub on demand', async () => {
    const user = userEvent.setup();
    renderPanel(SETTINGS);

    await user.click(screen.getByRole('button', { name: 'Refresh from GitHub' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('/api/integrations/github/repositories');
  });
});

describe('GithubPanel, permissions', () => {
  it('shows the list but hides every mutating affordance from a viewer who cannot manage', () => {
    renderPanel(SETTINGS, false);

    expect(screen.getByText('Noveum/ai-gateway')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove the/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Connect another organisation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh from GitHub' })).toBeNull();
  });
});
