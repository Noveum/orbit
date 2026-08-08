export const GITHUB_CONNECT_STATUSES = [
  'connected',
  'error',
  'denied',
  'claimed',
  'unverified',
  'misrouted',
] as const;
export type GithubConnectStatus = (typeof GITHUB_CONNECT_STATUSES)[number];

export interface GithubInstallationSummary {
  readonly installationId: string;
  readonly accountLogin: string;
  readonly accountType: string;
  readonly repositorySelection: string;
  readonly status: string;
  readonly repositoryCount: number;
  readonly manageUrl: string;
}

export interface GithubProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface GithubRepositoryLinkView {
  readonly id: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
}

export interface GithubRepositoryEntry {
  readonly id: string;
  readonly repositoryId: string;
  readonly fullName: string;
  readonly name: string;
  readonly ownerLogin: string;
  readonly private: boolean;
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
  readonly installationId: string;
  readonly accountLogin: string;
  readonly links: readonly GithubRepositoryLinkView[];
}

export interface GithubSettingsView {
  readonly connected: boolean;
  readonly connectEnabled: boolean;
  readonly discoveryEnabled: boolean;
  readonly installations: readonly GithubInstallationSummary[];
  readonly repositories: readonly GithubRepositoryEntry[];
  readonly projects: readonly GithubProjectOption[];
}
